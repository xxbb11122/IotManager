package com.iot.manager.dto;

import com.iot.manager.weather.EnvironmentIndicator;

public record EnvironmentIndicatorsView(
        EnvironmentIndicator temperature,
        EnvironmentIndicator humidity,
        EnvironmentIndicator pressure,
        EnvironmentIndicator esdRisk,
        EnvironmentIndicator condensationRisk
) { }
