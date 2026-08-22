package com.iot.manager.edgeagent.config;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Objects;

/** Immutable runtime configuration loaded from an operator-owned properties file. */
public record AgentConfig(
        String agentName,
        String siteCode,
        Path identityFile,
        URI backendWebSocketUri,
        Duration heartbeatInterval,
        Duration discoveryInterval,
        Duration reconnectDelay,
        Duration requestTimeout,
        List<URI> shellyEndpoints,
        String webSocketAccessToken,
        String agentCredentialId,
        String agentCredentialToken
) {
    /** Backward-compatible constructor for local test/dev configurations. */
    public AgentConfig(
            String agentName,
            String siteCode,
            Path identityFile,
            URI backendWebSocketUri,
            Duration heartbeatInterval,
            Duration discoveryInterval,
                Duration reconnectDelay,
                Duration requestTimeout,
                List<URI> shellyEndpoints
    ) {
        this(agentName, siteCode, identityFile, backendWebSocketUri, heartbeatInterval,
                discoveryInterval, reconnectDelay, requestTimeout, shellyEndpoints, null, null, null);
    }

    /** Backward-compatible bearer-token constructor for the transition period. */
    public AgentConfig(
            String agentName,
            String siteCode,
            Path identityFile,
            URI backendWebSocketUri,
            Duration heartbeatInterval,
            Duration discoveryInterval,
            Duration reconnectDelay,
            Duration requestTimeout,
            List<URI> shellyEndpoints,
            String webSocketAccessToken
    ) {
        this(agentName, siteCode, identityFile, backendWebSocketUri, heartbeatInterval,
                discoveryInterval, reconnectDelay, requestTimeout, shellyEndpoints,
                webSocketAccessToken, null, null);
    }

    public AgentConfig {
        agentName = requireText(agentName, "agentName");
        siteCode = requireText(siteCode, "siteCode");
        identityFile = Objects.requireNonNull(identityFile, "identityFile").toAbsolutePath().normalize();
        backendWebSocketUri = requireWebSocketUri(backendWebSocketUri);
        heartbeatInterval = requirePositive(heartbeatInterval, "heartbeatInterval");
        discoveryInterval = requirePositive(discoveryInterval, "discoveryInterval");
        reconnectDelay = requirePositive(reconnectDelay, "reconnectDelay");
        requestTimeout = requirePositive(requestTimeout, "requestTimeout");
        shellyEndpoints = List.copyOf(Objects.requireNonNull(shellyEndpoints, "shellyEndpoints"));
        webSocketAccessToken = normalizeOptional(webSocketAccessToken);
        agentCredentialId = normalizeOptional(agentCredentialId);
        agentCredentialToken = normalizeOptional(agentCredentialToken);
        if ((agentCredentialId == null) != (agentCredentialToken == null)) {
            throw new IllegalArgumentException("agentCredentialId and agentCredentialToken must be provided together");
        }
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value.trim();
    }

    private static URI requireWebSocketUri(URI uri) {
        Objects.requireNonNull(uri, "backendWebSocketUri");
        if (("ws".equalsIgnoreCase(uri.getScheme()) || "wss".equalsIgnoreCase(uri.getScheme()))
                && uri.getHost() != null) {
            return uri;
        }
        throw new IllegalArgumentException("backendWebSocketUri must use ws:// or wss:// and include a host");
    }

    private static Duration requirePositive(Duration duration, String field) {
        Objects.requireNonNull(duration, field);
        if (duration.isNegative() || duration.isZero()) {
            throw new IllegalArgumentException(field + " must be positive");
        }
        return duration;
    }

    private static String normalizeOptional(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
