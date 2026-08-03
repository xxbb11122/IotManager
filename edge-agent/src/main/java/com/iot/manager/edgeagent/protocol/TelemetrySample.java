package com.iot.manager.edgeagent.protocol;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;

public record TelemetrySample(
        String deviceKey,
        String driverId,
        Map<String, Object> values,
        Instant observedAt
) {
    public TelemetrySample {
        deviceKey = ProtocolValue.text(deviceKey, "deviceKey");
        driverId = ProtocolValue.text(driverId, "driverId");
        values = ProtocolValue.map(values, "values");
        observedAt = Objects.requireNonNull(observedAt, "observedAt");
    }
}
