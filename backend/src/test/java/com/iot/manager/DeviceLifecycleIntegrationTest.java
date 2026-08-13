package com.iot.manager;

import com.iot.manager.dto.ActivityView;
import com.iot.manager.dto.ClaimLanDeviceRequest;
import com.iot.manager.dto.DeviceCommandRequest;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.dto.LanCandidateView;
import com.iot.manager.service.CommandSimulator;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;

import java.util.Arrays;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "iot.command-simulator.enabled=true",
                "iot.command-simulator.interval-ms=600000",
                "iot.command-simulator.initial-delay-ms=600000"
        }
)
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class DeviceLifecycleIntegrationTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private CommandSimulator commandSimulator;

    @Test
    void discoversClaimsAndAcknowledgesALanDeviceThroughTheHttpLifecycle() throws InterruptedException {
        ResponseEntity<LanCandidateView[]> discovery = restTemplate.getForEntity(
                "/api/discovery/lan?siteCode=demo-site",
                LanCandidateView[].class
        );

        assertThat(discovery.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(discovery.getBody()).isNotNull();
        LanCandidateView candidate = Arrays.stream(discovery.getBody())
                .findFirst()
                .orElseThrow();

        ResponseEntity<DeviceView> claim = restTemplate.postForEntity(
                "/api/discovery/lan/" + candidate.candidateId() + "/claim",
                new ClaimLanDeviceRequest(
                        "demo-site",
                        "/operations/field",
                        "Lifecycle field sensor " + UUID.randomUUID()
                ),
                DeviceView.class
        );

        assertThat(claim.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(claim.getBody()).isNotNull();
        DeviceView device = claim.getBody();
        assertThat(device.siteCode()).isEqualTo("demo-site");
        assertThat(device.spacePath()).isEqualTo("/operations/field");
        assertThat(device.connections())
                .singleElement()
                .satisfies(connection -> {
                    assertThat(connection.transport()).isEqualTo("LAN_AGENT");
                    assertThat(connection.status()).isEqualTo("CONNECTED");
                    assertThat(connection.externalId()).isEqualTo(candidate.candidateId());
                });

        ResponseEntity<DeviceCommandView> submission = restTemplate.postForEntity(
                "/api/devices/" + device.id() + "/commands",
                new DeviceCommandRequest(
                        "set_power",
                        "lifecycle-" + UUID.randomUUID(),
                        Map.of("on", true)
                ),
                DeviceCommandView.class
        );

        assertThat(submission.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(submission.getBody()).isNotNull();
        DeviceCommandView pending = submission.getBody();
        assertThat(pending.status()).isEqualTo("PENDING");
        assertThat(pending.source()).isEqualTo("LAN_MOCK");
        assertThat(pending.desiredState()).containsEntry("power", true);
        assertThat(pending.reportedState()).doesNotContainKey("power");

        commandSimulator.tick();

        DeviceCommandView acknowledged = pollUntilAcknowledged(pending.commandId());
        assertThat(acknowledged.status()).isEqualTo("ACKNOWLEDGED");
        assertThat(acknowledged.reportedState()).containsEntry("power", true);
        assertThat(acknowledged.acknowledgedAt()).isNotNull();

        ResponseEntity<ActivityView[]> activity = restTemplate.getForEntity(
                "/api/devices/" + device.id() + "/activity",
                ActivityView[].class
        );

        assertThat(activity.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(activity.getBody()).isNotNull();
        assertThat(activity.getBody())
                .extracting(ActivityView::eventType)
                .contains("device_claimed", "command_acknowledged");
    }

    private DeviceCommandView pollUntilAcknowledged(String commandId) throws InterruptedException {
        DeviceCommandView latest = null;

        for (int attempt = 0; attempt < 10; attempt++) {
            ResponseEntity<DeviceCommandView> response = restTemplate.getForEntity(
                    "/api/commands/" + commandId,
                    DeviceCommandView.class
            );

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(response.getBody()).isNotNull();
            latest = response.getBody();
            if ("ACKNOWLEDGED".equals(latest.status())) {
                return latest;
            }

            Thread.sleep(50);
        }

        assertThat(latest).isNotNull();
        assertThat(latest.status()).isEqualTo("ACKNOWLEDGED");
        return latest;
    }
}
