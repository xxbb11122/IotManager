package com.iot.manager.dto;

import java.time.Instant;

public record WeatherForecastPointView(
        Instant forecastAt,
        String conditionCode,
        String conditionText,
        String iconKey,
        Double temperatureC,
        Double temperatureMaxC,
        Double temperatureMinC,
        Integer precipitationProbabilityPct,
        Double windSpeedKmh
) { }
