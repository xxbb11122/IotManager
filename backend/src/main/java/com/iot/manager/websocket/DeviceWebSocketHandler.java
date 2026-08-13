package com.iot.manager.websocket;

import com.iot.manager.service.WebSocketService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@RequiredArgsConstructor
public class DeviceWebSocketHandler extends TextWebSocketHandler {

    private final WebSocketService wsService;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
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
