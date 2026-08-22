package com.iot.manager.config;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;

/**
 * Browser WebSocket clients cannot attach an Authorization header. New clients
 * send a short-lived JWT in an offered WebSocket subprotocol instead of the
 * URL, so proxies and access logs do not record it. The secure query-string
 * fallback remains only for an in-place upgrade of older clients.
 */
final class RestrictedWebSocketBearerTokenResolver implements BearerTokenResolver {

    static final String WEBSOCKET_BEARER_PROTOCOL_PREFIX = "iot-bearer.";

    private final DefaultBearerTokenResolver headerResolver = new DefaultBearerTokenResolver();

    @Override
    public String resolve(HttpServletRequest request) {
        String token = headerResolver.resolve(request);
        if (token != null || !isWebSocketPath(request)) {
            return token;
        }
        String protocolToken = protocolToken(request);
        if (protocolToken != null) {
            return protocolToken;
        }
        if (!request.isSecure()) {
            return null;
        }
        String queryToken = request.getParameter("access_token");
        return queryToken == null || queryToken.isBlank() ? null : queryToken.trim();
    }

    private boolean isWebSocketPath(HttpServletRequest request) {
        String path = request.getRequestURI();
        return path != null && (path.equals("/ws") || path.startsWith("/ws/"));
    }

    private String protocolToken(HttpServletRequest request) {
        String header = request.getHeader("Sec-WebSocket-Protocol");
        if (header == null || header.isBlank()) return null;
        for (String value : header.split(",")) {
            String candidate = value.trim();
            if (candidate.startsWith(WEBSOCKET_BEARER_PROTOCOL_PREFIX)) {
                String token = candidate.substring(WEBSOCKET_BEARER_PROTOCOL_PREFIX.length()).trim();
                if (!token.isEmpty()) return token;
            }
        }
        return null;
    }
}
