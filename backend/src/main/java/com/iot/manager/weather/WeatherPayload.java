package com.iot.manager.weather;

import java.time.Instant;
import java.util.List;

public record WeatherPayload(
        String providerCode,
        Instant observedAt,
        Double elevationM,
        Current current,
        List<Hourly> hourly,
        List<Daily> daily,
        String rawPayloadJson
) {
    public record Current(
            Integer weatherCode,
            Double temperatureC,
            Double apparentTemperatureC,
            Integer relativeHumidityPct,
            Double surfacePressureHpa,
            Double windSpeedKmh,
            Integer windDirectionDeg
    ) { }

    public record Hourly(
            Instant forecastAt,
            Integer weatherCode,
            Double temperatureC,
            Integer precipitationProbabilityPct,
            Double windSpeedKmh
    ) { }

    public record Daily(
            Instant forecastAt,
            Integer weatherCode,
            Double temperatureMaxC,
            Double temperatureMinC,
            Integer precipitationProbabilityPct,
            Double windSpeedKmh
    ) { }
}
