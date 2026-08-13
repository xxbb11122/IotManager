package com.iot.manager.controller;

import com.iot.manager.dto.ActivityView;
import com.iot.manager.dto.ApiProblem;
import com.iot.manager.dto.DeviceCommandRequest;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceConnection;
import com.iot.manager.repository.DeviceConnectionRepository;
import com.iot.manager.service.DeviceService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class CommandControllerTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private DeviceService deviceService;

    @Autowired
    private DeviceConnectionRepository connectionRepository;

    @Test
    void submitThenReadCommandAndActivityReturnsOnlyStableViews() {
        Device device = lanDevice("controller-success");

        ResponseEntity<DeviceCommandView> submit = restTemplate.postForEntity(
                "/api/devices/" + device.getId() + "/commands",
                new DeviceCommandRequest("set_power", "controller-" + UUID.randomUUID(), Map.of("on", true)),
                DeviceCommandView.class
        );

        assertThat(submit.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(submit.getBody()).isNotNull();
        assertThat(submit.getBody().source()).isEqualTo("LAN_MOCK");
        assertThat(submit.getBody().status()).isEqualTo("PENDING");
        assertThat(submit.getBody().desiredState()).containsEntry("power", true);

        ResponseEntity<DeviceCommandView> read = restTemplate.getForEntity(
                "/api/commands/" + submit.getBody().commandId(),
                DeviceCommandView.class
        );
        ResponseEntity<ActivityView[]> activity = restTemplate.getForEntity(
                "/api/devices/" + device.getId() + "/activity",
                ActivityView[].class
        );

        assertThat(read.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(read.getBody()).isNotNull();
        assertThat(read.getBody().deviceId()).isEqualTo(device.getId());
        assertThat(read.getBody().parameters()).containsEntry("on", true);
        assertThat(activity.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(activity.getBody()).isNotNull();
        assertThat(activity.getBody())
                .extracting(ActivityView::eventType)
                .contains("command_submitted");

        ResponseEntity<String> raw = restTemplate.getForEntity(
                "/api/commands/" + submit.getBody().commandId(),
                String.class
        );
        assertThat(raw.getBody()).doesNotContain("hibernateLazyInitializer", "\"device\":");
    }

    @Test
    void blankCommandFieldsAndInvalidSetLevelParameterReturnFieldAwareBadRequests() {
        Device device = lanDevice("controller-validation");

        ResponseEntity<ApiProblem> blank = restTemplate.postForEntity(
                "/api/devices/" + device.getId() + "/commands",
                new DeviceCommandRequest(" ", " ", Map.of()),
                ApiProblem.class
        );
        ResponseEntity<ApiProblem> invalidLevel = restTemplate.postForEntity(
                "/api/devices/" + device.getId() + "/commands",
                new DeviceCommandRequest("set_level", "invalid-" + UUID.randomUUID(), Map.of("level", "high")),
                ApiProblem.class
        );

        assertThat(blank.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(blank.getBody()).isNotNull();
        assertThat(blank.getBody().fieldErrors()).containsKeys("type", "idempotencyKey");
        assertThat(invalidLevel.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(invalidLevel.getBody()).isNotNull();
        assertThat(invalidLevel.getBody().fieldErrors()).containsKey("parameters.level");
    }

    @Test
    void nullSetLevelParameterReturnsAFieldAwareBadRequest() {
        Device device = lanDevice("controller-null-level");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        ResponseEntity<ApiProblem> response = restTemplate.exchange(
                "/api/devices/" + device.getId() + "/commands",
                HttpMethod.POST,
                new HttpEntity<>("""
                        {"type":"set_level","idempotencyKey":"null-level-%s","parameters":{"level":null}}
                        """.formatted(UUID.randomUUID()), headers),
                ApiProblem.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().fieldErrors()).containsKey("parameters.level");
    }

    @Test
    void oversizedCommandParametersReturnAFieldAwareBadRequest() {
        Device device = lanDevice("controller-oversized-parameters");

        ResponseEntity<ApiProblem> response = restTemplate.postForEntity(
                "/api/devices/" + device.getId() + "/commands",
                new DeviceCommandRequest(
                        "set_power",
                        "oversized-" + UUID.randomUUID(),
                        Map.of("on", true, "metadata", "x".repeat(4001))
                ),
                ApiProblem.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().fieldErrors()).containsKey("parameters");
    }

    @Test
    void nearLimitModeWithAnOversizedAcknowledgementResultReturnsFieldAwareBadRequest() {
        Device device = lanDevice("controller-oversized-result");

        ResponseEntity<String> response = restTemplate.postForEntity(
                "/api/devices/" + device.getId() + "/commands",
                new DeviceCommandRequest(
                        "set_mode",
                        "result-overflow-" + UUID.randomUUID(),
                        Map.of("mode", "x".repeat(3960))
                ),
                String.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody()).contains("\"result\"");
    }

    @Test
    void missingDeviceAndCommandReturnNotFoundApiProblems() {
        ResponseEntity<ApiProblem> missingDevice = restTemplate.postForEntity(
                "/api/devices/999999/commands",
                new DeviceCommandRequest("set_power", "missing-" + UUID.randomUUID(), Map.of("on", true)),
                ApiProblem.class
        );
        ResponseEntity<ApiProblem> missingCommand = restTemplate.getForEntity(
                "/api/commands/missing-command", ApiProblem.class
        );

        assertThat(missingDevice.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(missingDevice.getBody()).isNotNull();
        assertThat(missingCommand.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(missingCommand.getBody()).isNotNull();
    }

    private Device lanDevice(String suffix) {
        String token = UUID.randomUUID().toString();
        Device device = deviceService.create(Device.builder()
                .name("Command controller " + suffix + " " + token)
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
                .externalId("controller-command-" + suffix + "-" + token)
                .status("CONNECTED")
                .metadataJson("{}")
                .build());
        return device;
    }
}
