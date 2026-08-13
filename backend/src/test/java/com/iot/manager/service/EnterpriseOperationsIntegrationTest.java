package com.iot.manager.service;

import com.iot.manager.dto.CommandBatchRequest;
import com.iot.manager.dto.CommandBatchTarget;
import com.iot.manager.dto.CommandBatchView;
import com.iot.manager.dto.DeviceGroupCreateRequest;
import com.iot.manager.dto.DeviceGroupMembersRequest;
import com.iot.manager.dto.DeviceGroupView;
import com.iot.manager.dto.DeviceProfileView;
import com.iot.manager.entity.Device;
import com.iot.manager.repository.CommandEventRepository;
import com.iot.manager.repository.DeviceCommandRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("test")
class EnterpriseOperationsIntegrationTest {

    @Autowired
    private DeviceService deviceService;

    @Autowired
    private DeviceGroupService groupService;

    @Autowired
    private CommandBatchService batchService;

    @Autowired
    private CommandService commandService;

    @Autowired
    private DeviceCommandRepository commandRepository;

    @Autowired
    private CommandEventRepository commandEventRepository;

    @Autowired
    private DeviceProfileService profileService;

    @Test
    void profileCatalogExposesReferenceProfilesAndUnknownCommandsAreRejected() {
        List<DeviceProfileView> profiles = profileService.listEnabled();
        assertThat(profiles).extracting(DeviceProfileView::profileId)
                .contains("legacy-generic-v1", "nordic-nrf52840-switch-v1", "shelly-plus-plug-s-v1");

        Device nrf = device("nrf", "nordic-nrf52840-switch-v1");
        assertThatThrownBy(() -> commandService.submit(nrf.getId(), new com.iot.manager.dto.DeviceCommandRequest(
                "set_level", "nrf-level-" + UUID.randomUUID(), Map.of("level", 50)
        )))
                .isInstanceOf(CommandValidationException.class);
    }

    @Test
    void groupBatchSnapshotsTargetsAndTracksPartialSuccessAndAudit() {
        Device legacy = device("legacy", "legacy-generic-v1");
        Device nrf = device("nrf", "nordic-nrf52840-switch-v1");
        DeviceGroupView group = groupService.create(new DeviceGroupCreateRequest(
                "demo-site", "Line " + UUID.randomUUID(), "Batch test group"
        ));
        DeviceGroupView withMembers = groupService.changeMembers(group.groupId(), new DeviceGroupMembersRequest(
                group.version(), List.of(legacy.getId(), nrf.getId()), List.of()
        ));
        String key = "batch-" + UUID.randomUUID();
        CommandBatchRequest request = new CommandBatchRequest(
                "demo-site", new CommandBatchTarget(withMembers.groupId(), List.of()), "set_level", key, Map.of("level", 42), 300
        );

        CommandBatchView created = batchService.create(request);
        assertThat(created.totalCount()).isEqualTo(2);
        assertThat(created.pendingCount()).isEqualTo(1);
        assertThat(created.rejectedCount()).isEqualTo(1);
        assertThat(created.status()).isEqualTo("QUEUED");

        CommandBatchView duplicate = batchService.create(request);
        assertThat(duplicate.batchId()).isEqualTo(created.batchId());
        assertThat(commandRepository.findByBatchIdOrderByRequestedAtAscIdAsc(created.batchId())).hasSize(2);

        commandService.processPending();
        CommandBatchView completed = batchService.get(created.batchId());
        assertThat(completed.status()).isEqualTo("PARTIALLY_SUCCEEDED");
        assertThat(completed.acknowledgedCount()).isEqualTo(1);
        assertThat(completed.rejectedCount()).isEqualTo(1);

        commandRepository.findByBatchIdOrderByRequestedAtAscIdAsc(created.batchId()).forEach(command ->
                assertThat(commandEventRepository.findByCommandCommandIdOrderByOccurredAtAsc(command.getCommandId())).isNotEmpty()
        );
    }

    @Test
    void reusedBatchIdempotencyKeyWithDifferentParametersIsRejected() {
        Device device = device("idempotency", "legacy-generic-v1");
        String key = "batch-idempotency-" + UUID.randomUUID();
        batchService.create(new CommandBatchRequest(
                "demo-site", new CommandBatchTarget(null, List.of(device.getId())), "set_power", key, Map.of("on", true), 60
        ));
        assertThatThrownBy(() -> batchService.create(new CommandBatchRequest(
                "demo-site", new CommandBatchTarget(null, List.of(device.getId())), "set_power", key, Map.of("on", false), 60
        )))
                .isInstanceOf(IdempotencyConflictException.class);
    }

    private Device device(String suffix, String profileId) {
        return deviceService.create(Device.builder()
                .name("Enterprise " + suffix + " " + UUID.randomUUID())
                .deviceId("enterprise-" + suffix + "-" + UUID.randomUUID())
                .type("ACTUATOR")
                .protocol("API")
                .profileId(profileId)
                .profileVersion(1)
                .reportedStateJson("{}")
                .desiredStateJson("{}")
                .build());
    }
}
