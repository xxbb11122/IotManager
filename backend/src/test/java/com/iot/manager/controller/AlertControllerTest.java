package com.iot.manager.controller;

import com.iot.manager.dto.AlertView;
import com.iot.manager.entity.Alert;
import com.iot.manager.entity.Device;
import com.iot.manager.repository.AlertRepository;
import com.iot.manager.service.DeviceService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class AlertControllerTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private DeviceService deviceService;

    @Autowired
    private AlertRepository alertRepository;

    @Test
    void activeAlertsUseStableViewsInsteadOfHibernateEntities() {
        Device device = deviceService.create(Device.builder()
                .name("Alert DTO boundary device")
                .type("SENSOR")
                .protocol("MQTT")
                .build());
        Alert alert = alertRepository.save(Alert.builder()
                .device(device)
                .level("WARNING")
                .status("OPEN")
                .message("DTO boundary alert")
                .resolved(false)
                .build());

        ResponseEntity<AlertView[]> response = restTemplate.getForEntity("/api/alerts/active", AlertView[].class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotEmpty();
        assertThat(response.getBody())
                .anySatisfy(view -> {
                    assertThat(view.id()).isEqualTo(alert.getId());
                    assertThat(view.deviceId()).isEqualTo(device.getId());
                    assertThat(view.deviceName()).isEqualTo(device.getName());
                });

        ResponseEntity<String> jsonResponse = restTemplate.getForEntity("/api/alerts/active", String.class);
        assertThat(jsonResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(jsonResponse.getBody())
                .doesNotContain("hibernateLazyInitializer")
                .doesNotContain("ByteBuddyInterceptor")
                .doesNotContain("\"device\":{");
    }
}
