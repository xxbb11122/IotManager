package com.iot.manager.websocket;

import com.iot.manager.service.WebSocketService;
import com.iot.manager.service.EdgeAgentService;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketConfigurer {

    private final WebSocketService wsService;
    private final EdgeAgentService edgeAgentService;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(new DeviceWebSocketHandler(wsService), "/ws/devices")
                .setAllowedOrigins("*");
        registry.addHandler(new EdgeAgentWebSocketHandler(edgeAgentService), "/ws/edge/v1")
                .setAllowedOrigins("*");
    }
}
