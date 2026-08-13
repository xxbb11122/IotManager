package com.iot.manager.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record SiteWeatherSettingsRequest(
        Boolean enabled,
        @Pattern(regexp = "^(OPEN_METEO)?$", message = "must be OPEN_METEO") String providerCode,
        @DecimalMin(value = "-90.0") @DecimalMax(value = "90.0") Double latitude,
        @DecimalMin(value = "-180.0") @DecimalMax(value = "180.0") Double longitude,
        @Size(max = 64) String timezone,
        @DecimalMin(value = "-500.0") @DecimalMax(value = "9000.0") Double manualElevationM,
        Long condensationTemperatureDeviceId,
        @Size(max = 128) String condensationTemperatureField
) { }
