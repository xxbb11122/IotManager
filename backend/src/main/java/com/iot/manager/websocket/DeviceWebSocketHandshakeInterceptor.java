package com.iot.manager.websocket;

import com.iot.manager.config.IotSecurityProperties;
import com.iot.manager.config.WebAccessProperties;
import com.iot.manager.service.SiteAccessService;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

import java.security.Principal;
import java.util.List;
import java.util.Map;

/**
 * Copies the authenticated user's site scope into the WebSocket session.
 * Browser clients pass the short-lived bearer token through the restricted
 * {@code iot-bearer.<jwt>} WebSocket subprotocol; native clients can use the
 * normal Authorization header handled by Spring Security. A secure query
 * fallback remains only for clients upgrading from the previous release.
 */
public final class DeviceWebSocketHandshakeInterceptor implements HandshakeInterceptor {

    public static final String SITE_IDS_ATTRIBUTE = "iot.site-ids";
    public static final String SCOPE_ENFORCED_ATTRIBUTE = "iot.site-scope-enforced";

    private final IotSecurityProperties securityProperties;
    private final WebAccessProperties webAccessProperties;
    private final SiteAccessService siteAccessService;

    public DeviceWebSocketHandshakeInterceptor(
            IotSecurityProperties securityProperties,
            WebAccessProperties webAccessProperties,
            SiteAccessService siteAccessService
    ) {
        this.securityProperties = securityProperties;
        this.webAccessProperties = webAccessProperties;
        this.siteAccessService = siteAccessService;
    }

    @Override
    public boolean beforeHandshake(
            ServerHttpRequest request,
            ServerHttpResponse response,
            WebSocketHandler wsHandler,
            Map<String, Object> attributes
    ) {
        if (!securityProperties.isEnabled()) {
            attributes.put(SCOPE_ENFORCED_ATTRIBUTE, false);
            return true;
        }
        if (webAccessProperties.isRequireSecureTransport() && !isSecureTransport(request)) {
            return false;
        }

        Principal principal = request.getPrincipal();
        if (!(principal instanceof Authentication authentication)
                || !(authentication instanceof JwtAuthenticationToken jwt)) {
            return false;
        }

        String siteCode = UriComponentsBuilder.fromUri(request.getURI())
                .build()
                .getQueryParams()
                .getFirst("siteCode");
        try {
            List<Long> siteIds = siteAccessService.siteIdsForSubjectAndCode(
                    jwt.getToken().getSubject(), siteCode
            );
            if (siteIds == null || siteIds.isEmpty()) {
                return false;
            }
            attributes.put(SCOPE_ENFORCED_ATTRIBUTE, true);
            attributes.put(SITE_IDS_ATTRIBUTE, siteIds);
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
        // No token or membership data is retained beyond the session scope.
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
