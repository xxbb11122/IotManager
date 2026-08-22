package com.iot.manager.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.RealtimeEvent;
import com.iot.manager.entity.Site;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.SiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WebSocketServiceTest {

    @Mock
    private DeviceRepository deviceRepository;

    @Mock
    private SiteRepository siteRepository;

    @Mock
    private ApplicationEventPublisher eventPublisher;

    @Mock
    private PlatformMetricsService platformMetricsService;

    private WebSocketService webSocketService;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        webSocketService = new WebSocketService(
                objectMapper, deviceRepository, siteRepository, eventPublisher, platformMetricsService
        );
    }

    @Test
    void scopedSessionReceivesOnlyEventsFromItsAuthorizedSites() throws Exception {
        WebSocketSession session = openSession("site-10");
        webSocketService.register(session, List.of(10L));

        webSocketService.deliverAfterCommit(new RealtimeEvent(
                "device_update", Map.of("deviceId", "device-a", "siteId", 10L)
        ));
        webSocketService.deliverAfterCommit(new RealtimeEvent(
                "device_update", Map.of("deviceId", "device-b", "siteId", 20L)
        ));

        ArgumentCaptor<TextMessage> messages = ArgumentCaptor.forClass(TextMessage.class);
        verify(session, times(1)).sendMessage(messages.capture());
        JsonNode event = objectMapper.readTree(messages.getValue().getPayload());
        assertThat(event.path("type").asText()).isEqualTo("device_update");
        assertThat(event.path("payload").path("siteId").asLong()).isEqualTo(10L);
    }

    @Test
    void scopedCollectionEventsAreFilteredAndSiteLessEventsFailClosed() throws Exception {
        WebSocketSession session = openSession("collection-site-10");
        webSocketService.register(session, List.of(10L));

        webSocketService.deliverAfterCommit(new RealtimeEvent(
                "telemetry_update",
                List.of(
                        Map.of("deviceId", "device-a", "siteId", 10L),
                        Map.of("deviceId", "device-b", "siteId", 20L)
                )
        ));
        webSocketService.deliverAfterCommit(new RealtimeEvent(
                "stats", Map.of("online", 1)
        ));

        ArgumentCaptor<TextMessage> messages = ArgumentCaptor.forClass(TextMessage.class);
        verify(session, times(1)).sendMessage(messages.capture());
        JsonNode payload = objectMapper.readTree(messages.getValue().getPayload()).path("payload");
        assertThat(payload).hasSize(1);
        assertThat(payload.get(0).path("siteId").asLong()).isEqualTo(10L);
    }

    @Test
    void ambiguousSiteCodeNeverOverridesAnExactSiteIdOrLeaksAcrossOrganizations() throws Exception {
        WebSocketSession session = openSession("shared-code-site-10");
        webSocketService.register(session, List.of(10L));
        when(siteRepository.findAllByCode("shared-site")).thenReturn(List.of(
                Site.builder().id(10L).code("shared-site").build(),
                Site.builder().id(20L).code("shared-site").build()
        ));

        webSocketService.deliverAfterCommit(new RealtimeEvent(
                "weather_update", Map.of("siteId", 20L, "siteCode", "shared-site")
        ));
        webSocketService.deliverAfterCommit(new RealtimeEvent(
                "weather_update", Map.of("siteCode", "shared-site")
        ));

        verify(session, never()).sendMessage(org.mockito.ArgumentMatchers.any(TextMessage.class));
    }

    private WebSocketSession openSession(String id) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        when(session.isOpen()).thenReturn(true);
        return session;
    }
}
