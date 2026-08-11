package com.iot.manager.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.ClaimLanDeviceRequest;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.dto.LanCandidateView;
import com.iot.manager.entity.DeviceConnection;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.DeviceConnectionRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.util.List;
import java.util.NoSuchElementException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SpringBootTest
@ActiveProfiles("test")
class LanDiscoveryServiceTest {

    @Autowired
    private LanDiscoveryService lanDiscoveryService;

    @Autowired
    private DeviceConnectionRepository connectionRepository;

    @Autowired
    private ActivityEventRepository activityEventRepository;

    @Autowired
    private WebSocketService webSocketService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Test
    void candidateCatalogIsDeterministicAndListedForDemoSite() {
        List<LanCandidateView> firstListing = lanDiscoveryService.listCandidates("demo-site");
        List<LanCandidateView> secondListing = lanDiscoveryService.listCandidates("demo-site");

        assertThat(firstListing).isEqualTo(secondListing);
        assertThat(firstListing)
                .extracting(LanCandidateView::candidateId)
                .contains("lan-demo-sensor-01", "lan-demo-sensor-06");
        assertThat(firstListing).allSatisfy(candidate -> {
            assertThat(candidate.transport()).isEqualTo("LAN_AGENT");
            assertThat(candidate.ipAddress()).startsWith("192.168.10.");
        });
    }

    @Test
    void claimCreatesDeviceConnectionAndActivityInRequestedSpace() {
        DeviceView claimed = lanDiscoveryService.claim(
                "lan-demo-sensor-02",
                new ClaimLanDeviceRequest("demo-site", "/operations/field", "Claimed field sensor")
        );

        assertThat(claimed.name()).isEqualTo("Claimed field sensor");
        assertThat(claimed.siteCode()).isEqualTo("demo-site");
        assertThat(claimed.spacePath()).isEqualTo("/operations/field");
        assertThat(claimed.connections())
                .singleElement()
                .satisfies(connection -> {
                    assertThat(connection.transport()).isEqualTo("LAN_AGENT");
                    assertThat(connection.status()).isEqualTo("CONNECTED");
                    assertThat(connection.externalId()).isEqualTo("lan-demo-sensor-02");
                    assertThat(connection.metadata()).containsEntry("model", "LX-100");
                    assertThat(connection.metadata()).containsEntry("ipAddress", "192.168.10.22");
                    assertThat(connection.metadata()).containsEntry("profileId", "lan-agent-v1");
                });

        assertThat(connectionRepository.findByDeviceId(claimed.id()))
                .singleElement()
                .satisfies(connection -> assertLanAgentConnection(connection, "lan-demo-sensor-02"));
        assertThat(activityEventRepository.findByDeviceIdOrderByOccurredAtDesc(claimed.id()))
                .anySatisfy(event -> {
                    assertThat(event.getEventType()).isEqualTo("device_claimed");
                    assertThat(event.getPayloadJson())
                            .contains("lan-demo-sensor-02")
                            .contains("demo-site")
                            .contains("/operations/field");
                })
                .anySatisfy(event -> assertThat(event.getEventType()).isEqualTo("DEVICE_REGISTERED"));
    }

    @Test
    void duplicateClaimConflictsForTheLifetimeOfTheProcess() {
        ClaimLanDeviceRequest request = new ClaimLanDeviceRequest(
                "demo-site",
                "/operations/field",
                "Reserved field sensor"
        );

        lanDiscoveryService.claim("lan-demo-sensor-03", request);

        assertThatThrownBy(() -> lanDiscoveryService.claim("lan-demo-sensor-03", request))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("already claimed");
    }

    @Test
    void rolledBackClaimReleasesTheCandidateReservation() {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.executeWithoutResult(status -> {
            lanDiscoveryService.claim(
                    "lan-demo-sensor-06",
                    new ClaimLanDeviceRequest("demo-site", "/operations/field", "Rolled back field sensor")
            );
            status.setRollbackOnly();
        });

        assertThat(lanDiscoveryService.listCandidates("demo-site"))
                .extracting(LanCandidateView::candidateId)
                .contains("lan-demo-sensor-06");
    }

    @Test
    void rolledBackClaimDoesNotPublishConnectionOrActivityEvents() throws Exception {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("lan-rollback-capture");
        when(session.isOpen()).thenReturn(true);
        webSocketService.register(session);

        try {
            TransactionTemplate transaction = new TransactionTemplate(transactionManager);
            transaction.executeWithoutResult(status -> {
                lanDiscoveryService.claim(
                        "lan-demo-sensor-01",
                        new ClaimLanDeviceRequest("demo-site", "/operations/field", "Rolled back event sensor")
                );
                status.setRollbackOnly();
            });

            verify(session, never()).sendMessage(any(TextMessage.class));
        } finally {
            webSocketService.unregister(session);
        }
    }

    @Test
    void missingSiteOrSpaceReturnsNotFoundAtTheServiceLayer() {
        assertThatThrownBy(() -> lanDiscoveryService.claim(
                "lan-demo-sensor-04",
                new ClaimLanDeviceRequest("missing-site", "/operations/field", "Unknown site")
        ))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessageContaining("Site");

        assertThatThrownBy(() -> lanDiscoveryService.claim(
                "lan-demo-sensor-04",
                new ClaimLanDeviceRequest("demo-site", "/missing", "Unknown space")
        ))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessageContaining("Space");
    }

    @Test
    void claimPublishesConcreteVersionedConnectionAndActivityEventsAfterCommit() throws Exception {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("lan-claim-capture");
        when(session.isOpen()).thenReturn(true);
        webSocketService.register(session);

        try {
            lanDiscoveryService.claim(
                    "lan-demo-sensor-05",
                    new ClaimLanDeviceRequest("demo-site", "/operations/field", "Broadcast field sensor")
            );

            ArgumentCaptor<TextMessage> messageCaptor = ArgumentCaptor.forClass(TextMessage.class);
            verify(session, times(3)).sendMessage(messageCaptor.capture());
            List<JsonNode> events = messageCaptor.getAllValues().stream()
                    .map(message -> readEvent(message.getPayload()))
                    .toList();

            JsonNode connectionEvent = events.stream()
                    .filter(event -> "connection_update".equals(event.path("type").asText()))
                    .findFirst()
                    .orElseThrow();
            assertThat(connectionEvent.path("version").asInt()).isEqualTo(1);
            assertThat(connectionEvent.path("payload").path("transport").asText()).isEqualTo("LAN_AGENT");
            assertThat(connectionEvent.path("payload").path("externalId").asText())
                    .isEqualTo("lan-demo-sensor-05");

            JsonNode activityEvent = events.stream()
                    .filter(event -> "activity_update".equals(event.path("type").asText()))
                    .findFirst()
                    .orElseThrow();
            assertThat(activityEvent.path("version").asInt()).isEqualTo(1);
            assertThat(activityEvent.path("payload").path("eventType").asText()).isEqualTo("device_claimed");

            JsonNode deviceEvent = events.stream()
                    .filter(event -> "device_update".equals(event.path("type").asText()))
                    .findFirst()
                    .orElseThrow();
            assertThat(deviceEvent.path("payload").path("deviceId").asText()).isNotBlank();
            assertThat(deviceEvent.path("payload").path("status").asText()).isEqualTo("OFFLINE");
        } finally {
            webSocketService.unregister(session);
        }
    }

    private void assertLanAgentConnection(DeviceConnection connection, String candidateId) {
        assertThat(connection.getTransport()).isEqualTo("LAN_AGENT");
        assertThat(connection.getStatus()).isEqualTo("CONNECTED");
        assertThat(connection.getExternalId()).isEqualTo(candidateId);
        assertThat(connection.getMetadataJson())
                .contains("model")
                .contains("ipAddress")
                .contains("signal")
                .contains("profileId");
    }

    private JsonNode readEvent(String payload) {
        try {
            return objectMapper.readTree(payload);
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }
}
