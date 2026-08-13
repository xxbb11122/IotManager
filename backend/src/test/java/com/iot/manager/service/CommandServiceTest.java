package com.iot.manager.service;

import com.iot.manager.dto.DeviceCommandRequest;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceConnection;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.DeviceCommandRepository;
import com.iot.manager.repository.DeviceConnectionRepository;
import com.iot.manager.repository.DeviceRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("test")
class CommandServiceTest {

    @Autowired
    private CommandService commandService;

    @Autowired
    private DeviceService deviceService;

    @Autowired
    private DeviceConnectionRepository connectionRepository;

    @Autowired
    private DeviceCommandRepository commandRepository;

    @Autowired
    private DeviceRepository deviceRepository;

    @Autowired
    private ActivityEventRepository activityEventRepository;

    @Test
    void submitCreatesPendingLanMockCommandAndOnlyChangesDesiredState() {
        Device device = lanDevice("submit");

        DeviceCommandView command = commandService.submit(device.getId(), new DeviceCommandRequest(
                "set_power",
                "power-submit-" + UUID.randomUUID(),
                Map.of("on", true)
        ));

        assertThat(command.commandId()).isNotBlank();
        assertThat(command.deviceId()).isEqualTo(device.getId());
        assertThat(command.source()).isEqualTo("LAN_MOCK");
        assertThat(command.status()).isEqualTo("PENDING");
        assertThat(command.parameters()).containsEntry("on", true);
        assertThat(command.desiredState()).containsEntry("power", true);
        assertThat(command.reportedState()).isEmpty();
        assertThat(command.result()).isEmpty();
        assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()))
                .anySatisfy(event -> assertThat(event.getEventType()).isEqualTo("command_submitted"));
    }

    @Test
    void commandViewsPreserveNestedNullParametersAndFreezeNestedValues() {
        Device device = lanDevice("nested-parameters");
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("nullable", null);
        Map<String, Object> parameters = new LinkedHashMap<>();
        parameters.put("on", true);
        parameters.put("metadata", nested);

        DeviceCommandView submitted = commandService.submit(device.getId(), new DeviceCommandRequest(
                "set_power",
                "nested-" + UUID.randomUUID(),
                parameters
        ));
        DeviceCommandView reloaded = commandService.getByCommandId(submitted.commandId());

        assertNestedNullAndImmutability(submitted);
        assertNestedNullAndImmutability(reloaded);
    }

    @Test
    void submitDoesNotPersistNestedParameterMutationsMadeAfterRequestConstruction() {
        Device device = lanDevice("nested-copy");
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("requested", "before-submit");
        Map<String, Object> parameters = new LinkedHashMap<>();
        parameters.put("on", true);
        parameters.put("metadata", nested);
        DeviceCommandRequest request = new DeviceCommandRequest(
                "set_power",
                "nested-copy-" + UUID.randomUUID(),
                parameters
        );

        nested.put("mutatedAfterRequest", true);
        DeviceCommandView submitted = commandService.submit(device.getId(), request);
        DeviceCommandView reloaded = commandService.getByCommandId(submitted.commandId());

        assertThat(nestedParameters(submitted)).containsEntry("requested", "before-submit")
                .doesNotContainKey("mutatedAfterRequest");
        assertThat(nestedParameters(reloaded)).containsEntry("requested", "before-submit")
                .doesNotContainKey("mutatedAfterRequest");
    }

    @Test
    void validNearLimitParametersDoNotOverflowCompactCommandActivityPayload() {
        Device device = lanDevice("compact-activity");

        DeviceCommandView submitted = commandService.submit(device.getId(), new DeviceCommandRequest(
                "set_power",
                "compact-" + UUID.randomUUID(),
                Map.of("on", true, "metadata", "x".repeat(3900))
        ));

        assertThat(submitted.status()).isEqualTo("PENDING");
        assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()))
                .extracting(event -> event.getEventType())
                .contains("command_submitted");
    }

    @Test
    void submitRejectsDesiredStateThatWouldExceedItsStorageLimit() {
        Device device = lanDevice("oversized-state");
        String nearlyFullState = "{\"padding\":\"" + "x".repeat(3980) + "\"}";
        assertThat(nearlyFullState.length()).isLessThanOrEqualTo(4000);
        device.setDesiredStateJson(nearlyFullState);
        deviceRepository.saveAndFlush(device);

        assertThatThrownBy(() -> commandService.submit(device.getId(), new DeviceCommandRequest(
                "set_power",
                "state-overflow-" + UUID.randomUUID(),
                Map.of("on", true)
        )))
                .isInstanceOf(CommandValidationException.class)
                .satisfies(exception -> assertThat(((CommandValidationException) exception).getFieldErrors())
                        .containsKey("desiredState"));
    }

    @Test
    void submitRejectsModeWhoseAcknowledgementResultWouldExceedItsStorageLimitBeforePersisting() {
        Device device = lanDevice("oversized-result");
        String idempotencyKey = "result-overflow-" + UUID.randomUUID();
        int activitiesBefore = activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()).size();

        assertThatThrownBy(() -> commandService.submit(device.getId(), new DeviceCommandRequest(
                "set_mode",
                idempotencyKey,
                Map.of("mode", "x".repeat(3960))
        )))
                .isInstanceOf(CommandValidationException.class)
                .satisfies(exception -> assertThat(((CommandValidationException) exception).getFieldErrors())
                        .containsKey("result"));

        assertThat(commandRepository.findByDeviceIdAndIdempotencyKey(device.getId(), idempotencyKey)).isEmpty();
        assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()))
                .hasSize(activitiesBefore);
    }

    @Test
    void submitRejectsReportedStateThatWouldExceedItsStorageLimitBeforePersisting() {
        Device device = lanDevice("report-preflight");
        String idempotencyKey = "reported-overflow-" + UUID.randomUUID();
        String nearlyFullReportedState = "{\"padding\":\"" + "x".repeat(3980) + "\"}";
        assertThat(nearlyFullReportedState.length()).isLessThanOrEqualTo(4000);
        device.setReportedStateJson(nearlyFullReportedState);
        deviceRepository.saveAndFlush(device);
        int activitiesBefore = activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()).size();

        assertThatThrownBy(() -> commandService.submit(device.getId(), new DeviceCommandRequest(
                "set_power",
                idempotencyKey,
                Map.of("on", true)
        )))
                .isInstanceOf(CommandValidationException.class)
                .satisfies(exception -> assertThat(((CommandValidationException) exception).getFieldErrors())
                        .containsKey("reportedState"));

        assertThat(commandRepository.findByDeviceIdAndIdempotencyKey(device.getId(), idempotencyKey)).isEmpty();
        assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()))
                .hasSize(activitiesBefore);
    }

    @Test
    void processingAcknowledgesCommandAndUpdatesReportedStateOnlyAtAck() {
        Device device = lanDevice("ack");
        DeviceCommandView submitted = commandService.submit(device.getId(), new DeviceCommandRequest(
                "set_level",
                "level-ack-" + UUID.randomUUID(),
                Map.of("level", 42)
        ));

        DeviceCommandView acknowledged = commandService.processPending(submitted.commandId());

        assertThat(acknowledged.status()).isEqualTo("ACKNOWLEDGED");
        assertThat(acknowledged.desiredState()).containsEntry("level", 42);
        assertThat(acknowledged.reportedState()).containsEntry("level", 42);
        assertThat(acknowledged.result()).containsEntry("applied", true);
        assertThat(acknowledged.error()).isNull();
        assertThat(acknowledged.acknowledgedAt()).isNotNull();
        assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()))
                .extracting(event -> event.getEventType())
                .contains("command_submitted", "command_sent", "command_acknowledged");
    }

    @Test
    void processingSimulatedFailureRetainsReportedStateAndRecordsStructuredFailure() {
        Device device = lanDevice("failure");
        device.setReportedStateJson("{\"power\":false}");
        deviceRepository.saveAndFlush(device);
        DeviceCommandView submitted = commandService.submit(device.getId(), new DeviceCommandRequest(
                "simulate_failure",
                "failure-" + UUID.randomUUID(),
                Map.of()
        ));

        DeviceCommandView failed = commandService.processPending(submitted.commandId());

        assertThat(failed.status()).isEqualTo("FAILED");
        assertThat(failed.reportedState()).containsEntry("power", false);
        assertThat(failed.error()).isNotBlank();
        assertThat(failed.result()).containsEntry("applied", false);
        assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()))
                .extracting(event -> event.getEventType())
                .contains("command_failed");
    }

    @Test
    void processingLateReportedStateOverflowFailsOnceWithoutLeavingTheCommandPending() {
        Device device = lanDevice("late-overflow");
        DeviceCommandView submitted = commandService.submit(device.getId(), new DeviceCommandRequest(
                "set_power",
                "late-reported-state-overflow-" + UUID.randomUUID(),
                Map.of("on", true)
        ));
        String nearlyFullReportedState = "{\"padding\":\"" + "x".repeat(3980) + "\"}";
        assertThat(nearlyFullReportedState.length()).isLessThanOrEqualTo(4000);
        device.setReportedStateJson(nearlyFullReportedState);
        deviceRepository.saveAndFlush(device);

        DeviceCommandView failed = commandService.processPending(submitted.commandId());

        assertThat(failed.status()).isEqualTo("FAILED");
        assertThat(failed.reportedState()).containsEntry("padding", "x".repeat(3980));
        assertThat(failed.result()).containsEntry("applied", false);
        assertThat(failed.error()).isNotBlank();

        int failedActivities = (int) activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()).stream()
                .filter(event -> "command_failed".equals(event.getEventType()))
                .count();
        assertThat(commandService.processPending(submitted.commandId()).status()).isEqualTo("FAILED");
        assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()).stream()
                .filter(event -> "command_failed".equals(event.getEventType()))
                .count()).isEqualTo(failedActivities);
    }

    @Test
    void concurrentSubmissionsWithTheSameIdempotencyKeyReturnOnePersistedCommand() throws Exception {
        Device device = lanDevice("concurrent");
        String key = "concurrent-" + UUID.randomUUID();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);

        Callable<DeviceCommandView> submit = () -> {
            ready.countDown();
            start.await();
            return commandService.submit(device.getId(), new DeviceCommandRequest(
                    "set_mode",
                    key,
                    Map.of("mode", "eco")
            ));
        };

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<DeviceCommandView> first = executor.submit(submit);
            Future<DeviceCommandView> second = executor.submit(submit);
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();

            List<DeviceCommandView> commands = List.of(
                    first.get(5, TimeUnit.SECONDS),
                    second.get(5, TimeUnit.SECONDS)
            );
            assertThat(commands).extracting(DeviceCommandView::commandId).containsOnly(commands.get(0).commandId());
            assertThat(commandRepository.findByDeviceIdAndIdempotencyKey(device.getId(), key)).isPresent();
            assertThat(commandRepository.findByDeviceIdOrderByRequestedAtDesc(device.getId()))
                    .filteredOn(command -> key.equals(command.getIdempotencyKey()))
                    .hasSize(1);
        } finally {
            executor.shutdown();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void pendingBatchDoesNotUseOneOuterTransaction() throws NoSuchMethodException {
        assertThat(CommandService.class.getMethod("processPending")
                .isAnnotationPresent(Transactional.class)).isFalse();
    }

    @Test
    void concurrentPendingBatchesProcessTwoCommandsWithoutDuplicateLifecycleEntries() throws Exception {
        Device device = lanDevice("batch-concurrent");
        DeviceCommandView power = commandService.submit(device.getId(), new DeviceCommandRequest(
                "set_power", "batch-power-" + UUID.randomUUID(), Map.of("on", true)
        ));
        DeviceCommandView mode = commandService.submit(device.getId(), new DeviceCommandRequest(
                "set_mode", "batch-mode-" + UUID.randomUUID(), Map.of("mode", "eco")
        ));
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Callable<List<DeviceCommandView>> batch = () -> {
                ready.countDown();
                assertThat(start.await(5, TimeUnit.SECONDS)).isTrue();
                return commandService.processPending();
            };
            Future<List<DeviceCommandView>> first = executor.submit(batch);
            Future<List<DeviceCommandView>> second = executor.submit(batch);
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();

            first.get(5, TimeUnit.SECONDS);
            second.get(5, TimeUnit.SECONDS);

            assertThat(commandService.getByCommandId(power.commandId()).status()).isEqualTo("ACKNOWLEDGED");
            assertThat(commandService.getByCommandId(mode.commandId()).status()).isEqualTo("ACKNOWLEDGED");
            List<String> activityTypes = activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()).stream()
                    .map(event -> event.getEventType())
                    .toList();
            assertThat(activityTypes)
                    .filteredOn("command_sent"::equals)
                    .hasSize(2);
            assertThat(activityTypes)
                    .filteredOn("command_acknowledged"::equals)
                    .hasSize(2);
        } finally {
            executor.shutdown();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    private Device lanDevice(String suffix) {
        String token = suffix + "-" + UUID.randomUUID();
        Device device = deviceService.create(Device.builder()
                .name("Command service " + token)
                .deviceId("command-" + token)
                .type("ACTUATOR")
                .protocol("LAN_AGENT")
                .reportedStateJson("{}")
                .desiredStateJson("{}")
                .build());
        connectionRepository.saveAndFlush(DeviceConnection.builder()
                .device(device)
                .transport("LAN_AGENT")
                .profileId("lan-agent-v1")
                .externalId("command-test-" + token)
                .status("CONNECTED")
                .metadataJson("{}")
                .build());
        return device;
    }

    @SuppressWarnings("unchecked")
    private void assertNestedNullAndImmutability(DeviceCommandView command) {
        Map<String, Object> metadata = nestedParameters(command);
        assertThat(metadata).containsEntry("nullable", null);
        assertThatThrownBy(() -> metadata.put("other", "value"))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> nestedParameters(DeviceCommandView command) {
        return (Map<String, Object>) command.parameters().get("metadata");
    }
}
