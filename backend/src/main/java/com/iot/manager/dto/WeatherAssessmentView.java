package com.iot.manager.dto;

import java.time.Instant;

/** Server-authoritative validity; weather and surface telemetry have separate lifetimes. */
public record WeatherAssessmentView(
        Instant evaluatedAt,
        Instant weatherValidUntil,
        TemperatureSource temperatureSource
) {
    public record TemperatureSource(Long deviceId, String publicDeviceId, String field,
                                    Instant receivedAt, Instant validUntil) { }
}
