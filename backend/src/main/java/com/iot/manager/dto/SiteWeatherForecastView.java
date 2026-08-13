package com.iot.manager.dto;

import java.time.Instant;
import java.util.List;

public record SiteWeatherForecastView(
        String siteCode,
        String status,
        Instant fetchedAt,
        List<WeatherForecastPointView> hourly,
        List<WeatherForecastPointView> daily
) { }
