package com.iot.manager.dto;

import java.time.Instant;

public record SiteWeatherSettingsView(
        String siteCode,
        boolean enabled,
        String providerCode,
        Double latitude,
        Double longitude,
        String timezone,
        Double manualElevationM,
        String locationSource,
        Double locationAccuracyM,
        Instant locationUpdatedAt,
        Long condensationTemperatureDeviceId,
        String condensationTemperatureField,
        Instant lastFetchedAt,
        Instant lastRefreshAttemptAt,
        String lastRefreshError,
        String lastRefreshOutcome,
        Long lastRefreshDurationMs,
        Instant retryAfter,
        Instant lastManualRefreshAt
) { }
