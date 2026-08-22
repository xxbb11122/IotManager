package com.iot.manager.websocket;

import com.iot.manager.config.IotSecurityProperties;
import com.iot.manager.config.EdgeAgentSecurityProperties;
import com.iot.manager.service.AgentCredentialService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.Map;

/**
 * Authenticates the edge endpoint with a credential pair carried in headers.
 * The browser/user endpoint has a separate JWT interceptor; opaque agent
 * secrets are never accepted as REST or browser query parameters.
 */
@RequiredArgsConstructor
public final class EdgeAgentCredentialHandshakeInterceptor implements HandshakeInterceptor {

    public static final String CREDENTIAL_ENFORCED_ATTRIBUTE = "iot.edge-credential-enforced";
    public static final String AGENT_DATABASE_ID_ATTRIBUTE = "iot.edge-agent-database-id";
    public static final String AGENT_ID_ATTRIBUTE = "iot.edge-agent-id";
    public static final String SITE_ID_ATTRIBUTE = "iot.edge-site-id";
    public static final String SITE_CODE_ATTRIBUTE = "iot.edge-site-code";
    public static final String CREDENTIAL_ID_ATTRIBUTE = "iot.edge-credential-id";
    public static final String CREDENTIAL_HEADER = "X-Iot-Agent-Credential";
    public static final String TOKEN_HEADER = "X-Iot-Agent-Token";

    private final IotSecurityProperties securityProperties;
    private final EdgeAgentSecurityProperties transportProperties;
    private final AgentCredentialService credentialService;

    @Override
    public boolean beforeHandshake(
            ServerHttpRequest request,
            ServerHttpResponse response,
            WebSocketHandler wsHandler,
            Map<String, Object> attributes
    ) {
        if (!securityProperties.isEnabled()) {
            attributes.put(CREDENTIAL_ENFORCED_ATTRIBUTE, false);
            return true;
        }
        if (transportProperties.isRequireSecureTransport() && !isSecureTransport(request)) {
            return false;
        }
        String credentialId = request.getHeaders().getFirst(CREDENTIAL_HEADER);
        String token = request.getHeaders().getFirst(TOKEN_HEADER);
        try {
            AgentCredentialService.AuthenticatedAgent authenticated = credentialService.authenticate(credentialId, token);
            attributes.put(CREDENTIAL_ENFORCED_ATTRIBUTE, true);
            attributes.put(AGENT_DATABASE_ID_ATTRIBUTE, authenticated.agentDatabaseId());
            attributes.put(AGENT_ID_ATTRIBUTE, authenticated.agentId());
            attributes.put(SITE_ID_ATTRIBUTE, authenticated.siteId());
            attributes.put(SITE_CODE_ATTRIBUTE, authenticated.siteCode());
            attributes.put(CREDENTIAL_ID_ATTRIBUTE, authenticated.credentialId());
            return true;
        } catch (RuntimeException denied) {
            return false;
        }
    }

    @Override
    public void afterHandshake(
            ServerHttpRequest request,
            ServerHttpResponse response,
            WebSocketHandler wsHandler,
            Exception exception
    ) {
        // No secret is retained in the WebSocket attributes.
    }

    private boolean isSecureTransport(ServerHttpRequest request) {
        String forwardedProto = request.getHeaders().getFirst("X-Forwarded-Proto");
        if (forwardedProto != null && !forwardedProto.isBlank()) {
            return "https".equalsIgnoreCase(forwardedProto.split(",", 2)[0].trim());
        }
        String forwarded = request.getHeaders().getFirst("Forwarded");
        if (forwarded != null && forwarded.toLowerCase(java.util.Locale.ROOT).contains("proto=https")) {
            return true;
        }
        String scheme = request.getURI().getScheme();
        return "https".equalsIgnoreCase(scheme) || "wss".equalsIgnoreCase(scheme);
    }
}
