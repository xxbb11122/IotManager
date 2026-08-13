package com.iot.manager.controller;

import com.iot.manager.dto.DeviceView;
import com.iot.manager.dto.ApiProblem;
import com.iot.manager.dto.DeviceCreateRequest;
import com.iot.manager.dto.DeviceUpdateRequest;
import com.iot.manager.entity.Device;
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

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class DeviceControllerTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private DeviceService deviceService;

    @Test
    void listReturnsStableDeviceViewsWithoutHibernateFields() {
        Device created = deviceService.create(Device.builder()
                .name("DTO boundary test device")
                .type("SENSOR")
                .protocol("MQTT")
                .location("Test lab")
                .build());

        ResponseEntity<DeviceView[]> response = restTemplate.getForEntity("/api/devices", DeviceView[].class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotEmpty();
        DeviceView createdView = Arrays.stream(response.getBody())
                .filter(view -> view.id().equals(created.getId()))
                .findFirst()
                .orElseThrow();
        assertThat(createdView.publicId()).startsWith("device-");

        ResponseEntity<String> jsonResponse = restTemplate.getForEntity("/api/devices", String.class);
        assertThat(jsonResponse.getBody())
                .doesNotContain("hibernateLazyInitializer")
                .doesNotContain("\"handler\"")
                .doesNotContain("\"organization\"");
    }

    @Test
    void createKeepsConsoleStatusAndFirmwareVersionInTheDeviceView() {
        DeviceCreateRequest request = new DeviceCreateRequest(
                "Console compatible device",
                "SENSOR",
                "MQTT",
                "Control room",
                "v2.4.1",
                "ONLINE"
        );

        ResponseEntity<DeviceView> response = restTemplate.postForEntity("/api/devices", request, DeviceView.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo("ONLINE");
        assertThat(response.getBody().firmwareVersion()).isEqualTo("v2.4.1");
    }

    @Test
    void invalidCreateReturnsAFieldAwareApiProblem() {
        DeviceCreateRequest request = new DeviceCreateRequest(
                " ",
                "SENSOR",
                "MQTT",
                "Control room",
                null,
                "ONLINE"
        );

        ResponseEntity<ApiProblem> response = restTemplate.postForEntity("/api/devices", request, ApiProblem.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().fieldErrors()).containsKey("name");
    }

    @Test
    void missingDeviceReturnsNotFoundApiProblem() {
        ResponseEntity<ApiProblem> response = restTemplate.getForEntity("/api/devices/999999", ApiProblem.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo(HttpStatus.NOT_FOUND.value());
    }

    @Test
    void createRejectsAnUnknownStatusWithAFieldAwareApiProblem() {
        DeviceCreateRequest request = new DeviceCreateRequest(
                "Invalid status device",
                "SENSOR",
                "MQTT",
                "Control room",
                null,
                "BROKEN"
        );

        ResponseEntity<ApiProblem> response = restTemplate.postForEntity("/api/devices", request, ApiProblem.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().fieldErrors()).containsKey("status");
    }

    @Test
    void updateRejectsABlankStatusWithAFieldAwareApiProblem() {
        Device created = deviceService.create(Device.builder()
                .name("Update validation device")
                .type("SENSOR")
                .protocol("MQTT")
                .build());

        ResponseEntity<ApiProblem> response = restTemplate.exchange(
                "/api/devices/" + created.getId(),
                HttpMethod.PUT,
                new HttpEntity<>(new DeviceUpdateRequest(null, null, null, null, null, "")),
                ApiProblem.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().fieldErrors()).containsKey("status");
    }

    @Test
    void nullStatusKeepsTheCreateDefaultAndIsAllowedForPartialUpdates() {
        DeviceCreateRequest createRequest = new DeviceCreateRequest(
                "Default status device",
                "SENSOR",
                "MQTT",
                "Control room",
                null,
                null
        );

        ResponseEntity<DeviceView> createResponse = restTemplate.postForEntity(
                "/api/devices",
                createRequest,
                DeviceView.class
        );

        assertThat(createResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(createResponse.getBody()).isNotNull();
        assertThat(createResponse.getBody().status()).isEqualTo("OFFLINE");

        ResponseEntity<DeviceView> updateResponse = restTemplate.exchange(
                "/api/devices/" + createResponse.getBody().id(),
                HttpMethod.PUT,
                new HttpEntity<>(new DeviceUpdateRequest(null, null, null, "Updated control room", null, null)),
                DeviceView.class
        );

        assertThat(updateResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(updateResponse.getBody()).isNotNull();
        assertThat(updateResponse.getBody().status()).isEqualTo("OFFLINE");
    }

    @Test
    void malformedRequestBodyReturnsAnApiProblem() {
        ResponseEntity<String> response = restTemplate.exchange(
                "/api/devices",
                HttpMethod.POST,
                jsonRequest("{\"name\":"),
                String.class
        );

        assertBadRequestProblem(response, "Malformed request body");
    }

    @Test
    void invalidPathVariableReturnsAnApiProblem() {
        ResponseEntity<String> response = restTemplate.getForEntity("/api/devices/not-a-number", String.class);

        assertBadRequestProblem(response, "Invalid request parameter");
    }

    private HttpEntity<String> jsonRequest(String body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }

    private void assertBadRequestProblem(ResponseEntity<String> response, String message) {
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody())
                .contains("\"status\":400")
                .contains("\"error\":\"Bad Request\"")
                .contains("\"message\":\"" + message + "\"")
                .contains("\"fieldErrors\":{}")
                .doesNotContain("\"path\"");
    }
}
