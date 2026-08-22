package com.iot.manager.websocket;

import com.iot.manager.service.WebSocketService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Collection;

@RequiredArgsConstructor
public class DeviceWebSocketHandler extends TextWebSocketHandler {

    private final WebSocketService wsService;

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
