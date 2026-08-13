package com.iot.manager.repository;

import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceCommand;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class DeviceCommandRepositoryTest {

    @Autowired
    private DeviceRepository deviceRepository;

    @Autowired
    private DeviceCommandRepository deviceCommandRepository;

    @Test
    void rejectsDuplicateNonNullIdempotencyKeyForOneDevice() {
        Device device = saveDevice();
        deviceCommandRepository.saveAndFlush(command(device, "command-first", "retry-key"));

        assertThatThrownBy(() -> deviceCommandRepository.saveAndFlush(command(device, "command-second", "retry-key")))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void allowsMultipleNullIdempotencyKeysForOneDevice() {
        Device device = saveDevice();

        deviceCommandRepository.saveAndFlush(command(device, "command-null-first", null));
        deviceCommandRepository.saveAndFlush(command(device, "command-null-second", null));

        assertThat(deviceCommandRepository.findByDeviceIdOrderByRequestedAtDesc(device.getId())).hasSize(2);
    }

    @Test
    void findsPendingCommandIdsInRequestedAtThenIdOrder() {
        Device device = saveDevice();
        LocalDateTime requestedAt = LocalDateTime.now().minusMinutes(1);
        DeviceCommand first = command(device, "command-pending-first", "pending-first");
        first.setRequestedAt(requestedAt);
        first.setStatus("PENDING");
        DeviceCommand second = command(device, "command-pending-second", "pending-second");
        second.setRequestedAt(requestedAt);
        second.setStatus("PENDING");
        DeviceCommand later = command(device, "command-pending-later", "pending-later");
        later.setRequestedAt(requestedAt.plusSeconds(1));
        later.setStatus("PENDING");
        deviceCommandRepository.saveAndFlush(first);
        deviceCommandRepository.saveAndFlush(second);
        deviceCommandRepository.saveAndFlush(later);

        assertThat(deviceCommandRepository.findPendingCommandIdsOrderByRequestedAtAscIdAsc())
                .containsExactly("command-pending-first", "command-pending-second", "command-pending-later");
    }

    private Device saveDevice() {
        return deviceRepository.saveAndFlush(Device.builder()
                .name("Command test device")
                .deviceId("command-device")
                .build());
    }

    private DeviceCommand command(Device device, String commandId, String idempotencyKey) {
        return DeviceCommand.builder()
                .commandId(commandId)
                .device(device)
                .type("SYNC")
                .source("TEST")
                .idempotencyKey(idempotencyKey)
                .status("REQUESTED")
                .requestedAt(LocalDateTime.now())
                .build();
    }
}
