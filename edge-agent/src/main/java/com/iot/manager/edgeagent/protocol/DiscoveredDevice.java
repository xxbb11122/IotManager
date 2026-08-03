package com.iot.manager.edgeagent.protocol;

import java.net.URI;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;

/** A device found on the local network, keyed by a stable physical identity where possible. */
public record DiscoveredDevice(
        String deviceKey,
        String driverId,
        String profileId,
        String displayName,
        URI endpoint,
        Map<String, Object> identity,
        Map<String, Object> reportedState,
        Instant observedAt
) {
    public DiscoveredDevice {
        deviceKey = ProtocolValue.text(deviceKey, "deviceKey");
        driverId = ProtocolValue.text(driverId, "driverId");
        profileId = ProtocolValue.text(profileId, "profileId");
        displayName = ProtocolValue.text(displayName, "displayName");
        endpoint = Objects.requireNonNull(endpoint, "endpoint");
        identity = ProtocolValue.map(identity, "identity");
        reportedState = ProtocolValue.map(reportedState, "reportedState");
        observedAt = Objects.requireNonNull(observedAt, "observedAt");
    }
}
