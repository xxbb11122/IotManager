package com.iot.manager.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

/**
 * One origin allow-list is shared by REST CORS and WebSocket handshakes so the
 * two transports cannot accidentally have different browser exposure rules.
 */
@ConfigurationProperties(prefix = "iot.web")
public class WebAccessProperties {

    private List<String> allowedOrigins = new ArrayList<>(List.of("*"));
    private boolean requireSecureTransport;

    public List<String> getAllowedOrigins() {
        return List.copyOf(allowedOrigins);
    }

    public void setAllowedOrigins(List<String> allowedOrigins) {
        this.allowedOrigins = allowedOrigins == null ? new ArrayList<>() : new ArrayList<>(allowedOrigins);
    }

    public String[] allowedOriginsArray() {
        return allowedOrigins.stream()
                .filter(origin -> origin != null && !origin.isBlank())
                .map(String::trim)
                .toArray(String[]::new);
    }

    public boolean allowsWildcard() {
        return allowedOrigins.stream().anyMatch("*"::equals);
    }

    public boolean isRequireSecureTransport() {
        return requireSecureTransport;
    }

    public void setRequireSecureTransport(boolean requireSecureTransport) {
        this.requireSecureTransport = requireSecureTransport;
    }
}
