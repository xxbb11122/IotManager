package com.iot.manager.dto;

public record CurrentWeatherView(
        String conditionCode,
        String conditionText,
        String iconKey,
        Double temperatureC,
        Double apparentTemperatureC,
        Integer relativeHumidityPct,
        Double surfacePressureHpa,
        Double windSpeedKmh,
        Integer windDirectionDeg,
        Double elevationM,
        String elevationSource
) { }
