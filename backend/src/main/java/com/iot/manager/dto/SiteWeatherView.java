package com.iot.manager.dto;

import java.time.Instant;

public record SiteWeatherView(
        String siteCode,
        Long siteId,
        String status,
        String source,
        Instant observedAt,
        Instant fetchedAt,
        String refreshError,
        Instant retryAfter,
        CurrentWeatherView current,
        EnvironmentIndicatorsView indicators
) { }
