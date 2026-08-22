package com.iot.manager.websocket;

import com.iot.manager.config.WebAccessProperties;
import com.iot.manager.service.WebSocketService;
import com.iot.manager.service.EdgeAgentService;
import com.iot.manager.service.AgentCredentialService;
import com.iot.manager.service.SiteAccessService;
import com.iot.manager.config.IotSecurityProperties;
import com.iot.manager.config.EdgeAgentSecurityProperties;
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
    private final WebAccessProperties webAccessProperties;
    private final IotSecurityProperties securityProperties;
    private final SiteAccessService siteAccessService;
    private final AgentCredentialService credentialService;
    private final EdgeAgentSecurityProperties edgeAgentSecurityProperties;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(new DeviceWebSocketHandler(wsService), "/ws/devices")
                .addInterceptors(new DeviceWebSocketHandshakeInterceptor(
                        securityProperties, webAccessProperties, siteAccessService
                ))
                .setAllowedOrigins(webAccessProperties.allowedOriginsArray());
        registry.addHandler(new EdgeAgentWebSocketHandler(edgeAgentService), "/ws/edge/v1")
                .addInterceptors(new EdgeAgentCredentialHandshakeInterceptor(
                        securityProperties, edgeAgentSecurityProperties, credentialService
                ))
                .setAllowedOrigins(webAccessProperties.allowedOriginsArray());
    }
}
