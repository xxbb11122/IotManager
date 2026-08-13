package com.iot.manager.websocket;

import com.iot.manager.service.EdgeAgentService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@RequiredArgsConstructor
public class EdgeAgentWebSocketHandler extends TextWebSocketHandler {

    private final EdgeAgentService edgeAgentService;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        edgeAgentService.connected(session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        edgeAgentService.handle(session, message.getPayload());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        edgeAgentService.disconnected(session);
    }
}
