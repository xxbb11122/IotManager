package com.iot.manager.websocket;

import com.iot.manager.service.WebSocketService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.socket.*;
import org.springframework.web.socket.SubProtocolCapable;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Collection;
import java.util.List;

@RequiredArgsConstructor
public class DeviceWebSocketHandler extends TextWebSocketHandler implements SubProtocolCapable {

    /**
     * A non-secret protocol selected during browser WebSocket negotiation.
     * The JWT remains in the separately offered iot-bearer.<jwt> value, which
     * is consumed only from the request by RestrictedWebSocketBearerTokenResolver.
     * Selecting this stable value prevents Spring from echoing a bearer token
     * in the handshake response and satisfies browser subprotocol rules.
     */
    public static final String BROWSER_SUBPROTOCOL = "iot-v1";

    private final WebSocketService wsService;

    @Override
    public List<String> getSubProtocols() {
        return List.of(BROWSER_SUBPROTOCOL);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        Object enforced = session.getAttributes().get(DeviceWebSocketHandshakeInterceptor.SCOPE_ENFORCED_ATTRIBUTE);
        Object siteIds = session.getAttributes().get(DeviceWebSocketHandshakeInterceptor.SITE_IDS_ATTRIBUTE);
        if (Boolean.TRUE.equals(enforced) && siteIds instanceof Collection<?> values) {
            wsService.register(session, values.stream()
                    .filter(Number.class::isInstance)
                    .map(value -> ((Number) value).longValue())
                    .toList());
            return;
        }
        wsService.register(session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        // 客户端可发 ping，服务端回复 pong
        String payload = message.getPayload();
        if ("ping".equals(payload)) {
            try {
                session.sendMessage(new TextMessage("pong"));
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        wsService.unregister(session);
    }
}
