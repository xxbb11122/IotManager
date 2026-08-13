package com.iot.manager.service;

import com.iot.manager.entity.Alert;
import com.iot.manager.entity.Device;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.AlertRepository;
import com.iot.manager.repository.DeviceRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SpringBootTest(properties = {
        "iot.simulator.enabled=true",
        "iot.simulator.initial-device-count=0",
        "iot.simulator.interval-ms=7000",
        "iot.simulator.scheduling-enabled=false"
})
@ActiveProfiles("test")
class DeviceSimulatorTest {

    @Autowired
    private DeviceService deviceService;

    @Autowired
    private DeviceSimulator simulator;

    @Autowired
    private DeviceRepository deviceRepository;

    @Autowired
    private ActivityEventRepository activityEventRepository;

    @Autowired
    private AlertRepository alertRepository;

    @Autowired
    private WebSocketService webSocketService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Test
    void createdDeviceIsSafeForASimulatorTickAndHasARegistrationRecord() {
        Device created = deviceService.create(Device.builder()
                .name("Simulator-ready device")
                .type("SENSOR")
                .protocol("MQTT")
                .build());

        assertThat(created.getStatus()).isEqualTo("OFFLINE");
        assertThat(created.getTemperature()).isZero();
        assertThat(created.getHumidity()).isZero();
        assertThat(created.getCpuUsage()).isZero();
        assertThat(created.getUptimeSeconds()).isZero();
        assertThat(created.getSignalStrength()).isZero();

        assertThatCode(simulator::simulateTelemetryTick).doesNotThrowAnyException();

        Device persisted = deviceRepository.findById(created.getId()).orElseThrow();
        assertThat(persisted.getUptimeSeconds()).isEqualTo(7L);
        assertThat(persisted.getSpace()).isNotNull();
        assertThat(persisted.getSpace().getPath()).isEqualTo("/operations/field");
        assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(created.getId()))
                .anySatisfy(event -> assertThat(event.getEventType()).isEqualTo("DEVICE_REGISTERED"));
    }

    @Test
    void alertBroadcastUsesAVersionedRealtimeEventEnvelope() throws Exception {
        Device device = deviceService.create(Device.builder()
                .name("Alert event device")
                .type("SENSOR")
                .protocol("MQTT")
                .build());
        Alert alert = deviceService.createAlert(device, "WARNING", "Device requires attention");
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("alert-capture");
        when(session.isOpen()).thenReturn(true);
        webSocketService.register(session);

        try {
            webSocketService.sendAlert(alert);

            ArgumentCaptor<TextMessage> messageCaptor = ArgumentCaptor.forClass(TextMessage.class);
            verify(session).sendMessage(messageCaptor.capture());
            JsonNode message = objectMapper.readTree(messageCaptor.getValue().getPayload());
            assertThat(message.path("type").asText()).isEqualTo("alert");
            assertThat(message.path("payload").path("id").asLong()).isEqualTo(alert.getId());
            assertThat(message.path("timestamp").asLong()).isPositive();
            assertThat(message.path("version").asInt()).isEqualTo(1);
        } finally {
            webSocketService.unregister(session);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"WARNING", "OFFLINE"})
    void statusTransitionCreatesOneUnresolvedAlertAndEmitsIt(String requestedStatus) throws Exception {
        Device device = deviceService.create(Device.builder()
                .name("Status transition device " + requestedStatus)
                .type("SENSOR")
                .protocol("MQTT")
                .build());
        device.setStatus("ONLINE");
        device = deviceRepository.save(device);
        Long deviceId = device.getId();

        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("status-capture-" + requestedStatus);
        when(session.isOpen()).thenReturn(true);
        webSocketService.register(session);

        try {
            Device transitioned = simulator.applyStatusEventForTest(deviceId, requestedStatus);
            simulator.applyStatusEventForTest(deviceId, requestedStatus);

            List<Alert> alerts = alertRepository.findByResolvedFalseOrderByCreatedAtDesc().stream()
                    .filter(alert -> alert.getDevice().getId().equals(deviceId))
                    .toList();
            assertThat(transitioned.getStatus()).isEqualTo(requestedStatus);
            assertThat(alerts)
                    .singleElement()
                    .satisfies(alert -> {
                        assertThat(alert.isResolved()).isFalse();
                        assertThat(alert.getLevel()).isEqualTo(
                                "OFFLINE".equals(requestedStatus) ? "CRITICAL" : "WARNING"
                        );
                        assertThat(alert.getMessage()).contains(requestedStatus);
            });
            assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(deviceId))
                    .anyMatch(event -> event.getEventType().equals("DEVICE_" + requestedStatus));

            ArgumentCaptor<TextMessage> messageCaptor = ArgumentCaptor.forClass(TextMessage.class);
            verify(session, times(4)).sendMessage(messageCaptor.capture());
            List<JsonNode> events = new ArrayList<>();
            for (TextMessage message : messageCaptor.getAllValues()) {
                events.add(objectMapper.readTree(message.getPayload()));
            }

            JsonNode alertEvent = events.stream()
                    .filter(event -> "alert".equals(event.path("type").asText()))
                    .findFirst()
                    .orElseThrow();
            assertThat(alertEvent.path("payload").path("id").asLong()).isEqualTo(alerts.get(0).getId());
            assertThat(alertEvent.path("payload").path("deviceId").asText()).isEqualTo(device.getDeviceId());
            assertThat(alertEvent.path("payload").path("deviceName").asText()).isEqualTo(device.getName());
            assertThat(alertEvent.path("payload").path("deviceStatus").asText()).isEqualTo(requestedStatus);
            assertThat(alertEvent.path("version").asInt()).isEqualTo(1);

            JsonNode alertUpdateEvent = events.stream()
                    .filter(event -> "alert_update".equals(event.path("type").asText()))
                    .findFirst()
                    .orElseThrow();
            assertThat(alertUpdateEvent.path("payload").path("id").asLong()).isEqualTo(alerts.get(0).getId());
            assertThat(alertUpdateEvent.path("version").asInt()).isEqualTo(1);

            JsonNode activityEvent = events.stream()
                    .filter(event -> "activity_update".equals(event.path("type").asText()))
                    .findFirst()
                    .orElseThrow();
            assertThat(activityEvent.path("payload").path("eventType").asText())
                    .isEqualTo("DEVICE_" + requestedStatus);
            assertThat(activityEvent.path("version").asInt()).isEqualTo(1);

            JsonNode deviceEvent = events.stream()
                    .filter(event -> "device_update".equals(event.path("type").asText()))
                    .findFirst()
                    .orElseThrow();
            assertThat(deviceEvent.path("payload").path("deviceId").asText()).isEqualTo(device.getDeviceId());
            assertThat(deviceEvent.path("payload").path("status").asText()).isEqualTo(requestedStatus);
            assertThat(deviceEvent.path("version").asInt()).isEqualTo(1);
        } finally {
            webSocketService.unregister(session);
        }
    }

    @Test
    void simulatorEventsAreDispatchedOnlyAfterTheStatusTransactionCommits() throws Exception {
        Device device = onlineDevice("After-commit device");
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("after-commit-capture");
        when(session.isOpen()).thenReturn(true);
        webSocketService.register(session);

        try {
            TransactionTemplate transaction = new TransactionTemplate(transactionManager);
            transaction.executeWithoutResult(status -> {
                simulator.applyStatusEventForTest(device.getId(), "WARNING");
                assertNoWebSocketMessages(session);
            });

            verify(session, times(4)).sendMessage(any(TextMessage.class));
        } finally {
            webSocketService.unregister(session);
        }
    }

    @Test
    void warningReentryDoesNotCreateASecondUnresolvedAlert() {
        Device device = onlineDevice("Warning reentry device");

        simulator.applyStatusEventForTest(device.getId(), "WARNING");
        simulator.applyStatusEventForTest(device.getId(), "ONLINE");
        simulator.applyStatusEventForTest(device.getId(), "WARNING");

        List<Alert> unresolvedWarnings = alertRepository.findByResolvedFalseOrderByCreatedAtDesc().stream()
                .filter(alert -> alert.getDevice().getId().equals(device.getId()))
                .filter(alert -> alert.getLevel().equals("WARNING"))
                .filter(alert -> alert.getMessage().equals("Device entered WARNING status"))
                .toList();
        assertThat(unresolvedWarnings).singleElement();
        assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(device.getId()))
                .filteredOn(event -> event.getEventType().equals("DEVICE_WARNING"))
                .hasSize(2);
    }

    @Test
    void concurrentWarningTransitionsCreateOneUnresolvedAlert() throws Exception {
        Device device = onlineDevice("Concurrent warning device");
        CountDownLatch transactionsReady = new CountDownLatch(2);
        CountDownLatch startTransitions = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<?> first = executor.submit(() -> transitionToWarningInNewTransaction(
                    device.getId(),
                    transactionsReady,
                    startTransitions
            ));
            Future<?> second = executor.submit(() -> transitionToWarningInNewTransaction(
                    device.getId(),
                    transactionsReady,
                    startTransitions
            ));

            assertThat(transactionsReady.await(5, TimeUnit.SECONDS)).isTrue();
            startTransitions.countDown();
            first.get(10, TimeUnit.SECONDS);
            second.get(10, TimeUnit.SECONDS);

            List<Alert> unresolvedWarnings = alertRepository.findByResolvedFalseOrderByCreatedAtDesc().stream()
                    .filter(alert -> alert.getDevice().getId().equals(device.getId()))
                    .filter(alert -> alert.getLevel().equals("WARNING"))
                    .filter(alert -> alert.getMessage().equals("Device entered WARNING status"))
                    .toList();
            assertThat(unresolvedWarnings.size()).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void telemetryContractsPreserveTheLegacyTypeAndPublishTheNewType() throws Exception {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("telemetry-contract-capture");
        when(session.isOpen()).thenReturn(true);
        webSocketService.register(session);

        try {
            List<Map<String, Object>> updates = List.of(Map.of("deviceId", "DEV-TELEMETRY", "status", "ONLINE"));
            webSocketService.sendDeviceUpdates(updates);
            webSocketService.broadcastEvent("telemetry_update", updates);

            ArgumentCaptor<TextMessage> messageCaptor = ArgumentCaptor.forClass(TextMessage.class);
            verify(session, times(2)).sendMessage(messageCaptor.capture());
            List<JsonNode> events = new ArrayList<>();
            for (TextMessage message : messageCaptor.getAllValues()) {
                events.add(objectMapper.readTree(message.getPayload()));
            }
            assertThat(events)
                    .extracting(event -> event.path("type").asText())
                    .containsExactlyInAnyOrder("device_updates", "telemetry_update");
            assertThat(events).allSatisfy(event -> assertThat(event.path("version").asInt()).isEqualTo(1));
        } finally {
            webSocketService.unregister(session);
        }
    }

    private Device onlineDevice(String name) {
        Device device = deviceService.create(Device.builder()
                .name(name)
                .type("SENSOR")
                .protocol("MQTT")
                .build());
        device.setStatus("ONLINE");
        return deviceRepository.save(device);
    }

    private void assertNoWebSocketMessages(WebSocketSession session) {
        try {
            verify(session, never()).sendMessage(any(TextMessage.class));
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }

    private void transitionToWarningInNewTransaction(
            Long deviceId,
            CountDownLatch transactionsReady,
            CountDownLatch startTransitions
    ) {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.executeWithoutResult(status -> {
            transactionsReady.countDown();
            awaitLatch(startTransitions, 5);
            simulator.applyStatusEventForTest(deviceId, "WARNING");
        });
    }

    private void awaitLatch(CountDownLatch latch, long timeoutSeconds) {
        try {
            if (!latch.await(timeoutSeconds, TimeUnit.SECONDS)) {
                throw new AssertionError("Timed out waiting for concurrent transition");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new AssertionError(exception);
        }
    }

}
