package com.iot.manager.service;

import com.iot.manager.dto.DeviceCommandRequest;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceConnection;
import com.iot.manager.repository.DeviceConnectionRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = {
        "iot.command-simulator.enabled=true",
        "iot.command-simulator.interval-ms=600000",
        "iot.command-simulator.initial-delay-ms=600000"
})
@ActiveProfiles("test")
class CommandSimulatorTest {

    @Autowired
    private CommandSimulator commandSimulator;

    @Autowired
    private CommandService commandService;

    @Autowired
    private DeviceService deviceService;

    @Autowired
    private DeviceConnectionRepository connectionRepository;

    @Test
    void tickAcknowledgesSubmittedCommandsWhenEnabledForDevelopment() {
        Device device = lanDevice();
        DeviceCommandView submitted = commandService.submit(device.getId(), new DeviceCommandRequest(
                "set_power",
                "simulator-" + UUID.randomUUID(),
                Map.of("on", true)
        ));

        commandSimulator.tick();

        assertThat(commandService.getByCommandId(submitted.commandId()).status()).isEqualTo("ACKNOWLEDGED");
    }

    private Device lanDevice() {
        String token = UUID.randomUUID().toString();
        Device device = deviceService.create(Device.builder()
                .name("Command simulator " + token)
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
                .externalId("command-simulator-" + token)
                .status("CONNECTED")
                .metadataJson("{}")
                .build());
        return device;
    }
}
