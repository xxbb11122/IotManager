package com.iot.manager.edgeagent.driver;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Inputs made available to each discovery driver without coupling it to configuration parsing. */
public record DiscoveryContext(
        String siteCode,
        Map<String, List<URI>> seedEndpointsByDriver,
        Duration requestTimeout
) {
    public DiscoveryContext {
        if (siteCode == null || siteCode.isBlank()) {
            throw new IllegalArgumentException("siteCode must not be blank");
        }
        siteCode = siteCode.trim();
        seedEndpointsByDriver = Map.copyOf(Objects.requireNonNull(seedEndpointsByDriver, "seedEndpointsByDriver"));
        if (requestTimeout == null || requestTimeout.isNegative() || requestTimeout.isZero()) {
            throw new IllegalArgumentException("requestTimeout must be positive");
        }
    }

    public List<URI> seedEndpointsFor(String driverId) {
        return List.copyOf(seedEndpointsByDriver.getOrDefault(driverId, List.of()));
    }
}
