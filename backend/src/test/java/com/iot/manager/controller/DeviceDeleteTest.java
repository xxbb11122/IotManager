package com.iot.manager.controller;

import com.iot.manager.dto.ApiProblem;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.Alert;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceCommand;
import com.iot.manager.entity.DeviceConnection;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.AlertRepository;
import com.iot.manager.repository.DeviceCommandRepository;
import com.iot.manager.repository.DeviceConnectionRepository;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.service.DeviceService;
import com.iot.manager.service.WebSocketService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.mockito.ArgumentCaptor;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.time.LocalDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class DeviceDeleteTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private DeviceService deviceService;

    @Autowired
    private DeviceRepository deviceRepository;

    @Autowired
    private DeviceConnectionRepository connectionRepository;

    @Autowired
    private DeviceCommandRepository commandRepository;

    @Autowired
    private AlertRepository alertRepository;

    @Autowired
    private ActivityEventRepository activityEventRepository;

    @Autowired
    private WebSocketService webSocketService;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void deleteArchivesTheDeviceAndRetainsDependentRecordsForAudit() {
        Device device = deviceService.create(Device.builder()
                .name("FK cascade device")
                .type("SENSOR")
                .protocol("LAN_AGENT")
                .build());

        connectionRepository.save(DeviceConnection.builder()
                .device(device)
                .transport("LAN_AGENT")
                .status("CONNECTED")
                .build());
        commandRepository.save(DeviceCommand.builder()
                .commandId("command-" + UUID.randomUUID())
                .device(device)
                .type("set_power")
                .source("API")
                .status("PENDING")
                .requestedAt(LocalDateTime.now())
                .build());
        alertRepository.save(Alert.builder()
                .device(device)
                .level("WARNING")
                .message("delete cascade test alert")
                .resolved(false)
                .build());
        activityEventRepository.save(ActivityEvent.builder()
                .device(device)
                .eventType("DEVICE_REGISTERED")
                .detail("delete cascade test activity")
                .payloadJson("{}")
                .occurredAt(LocalDateTime.now())
                .build());

        ResponseEntity<Void> response = restTemplate.exchange(
                "/api/devices/" + device.getId(),
                HttpMethod.DELETE,
                null,
                Void.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(deviceRepository.findById(device.getId())).isPresent()
                .get().extracting(Device::getArchivedAt).isNotNull();
        assertThat(connectionRepository.findByDeviceId(device.getId())).hasSize(1);
        assertThat(commandRepository.findByDeviceIdOrderByRequestedAtDesc(device.getId())).hasSize(1);
        assertThat(alertRepository.findByDevice_Id(device.getId())).hasSize(1);
        assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()))
                .extracting(ActivityEvent::getEventType)
                .contains("DEVICE_ARCHIVED");
    }

    @Test
    void deleteMissingDeviceReturnsNotFound() {
        ResponseEntity<ApiProblem> response = restTemplate.exchange(
                "/api/devices/999999",
                HttpMethod.DELETE,
                null,
                ApiProblem.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo(HttpStatus.NOT_FOUND.value());
    }

    @Test
    void archivePublishesARealtimeRemovalEventAfterCommit() throws Exception {
        Device device = deviceService.create(Device.builder()
                .name("Realtime archive device")
                .type("SENSOR")
                .protocol("LAN_AGENT")
                .build());
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("archive-event-capture");
        when(session.isOpen()).thenReturn(true);
        webSocketService.register(session);

        try {
            ResponseEntity<Void> response = restTemplate.exchange(
                    "/api/devices/" + device.getId(), HttpMethod.DELETE, null, Void.class
            );

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
            ArgumentCaptor<TextMessage> messageCaptor = ArgumentCaptor.forClass(TextMessage.class);
            verify(session, times(1)).sendMessage(messageCaptor.capture());
            JsonNode event = objectMapper.readTree(messageCaptor.getValue().getPayload());
            assertThat(event.path("type").asText()).isEqualTo("device_archived");
            assertThat(event.path("payload").path("deviceId").asText()).isEqualTo(device.getDeviceId());
        } finally {
            webSocketService.unregister(session);
        }
    }
}
