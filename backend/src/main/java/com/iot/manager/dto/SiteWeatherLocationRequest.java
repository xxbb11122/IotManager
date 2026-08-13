package com.iot.manager.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * An explicitly user-initiated weather location update. The application only
 * sends this after the user chooses either device location or manual entry.
 */
public record SiteWeatherLocationRequest(
        @NotNull @DecimalMin(value = "-90.0") @DecimalMax(value = "90.0") Double latitude,
        @NotNull @DecimalMin(value = "-180.0") @DecimalMax(value = "180.0") Double longitude,
        @DecimalMin(value = "0.0") @DecimalMax(value = "100000.0") Double accuracyM,
        @NotBlank @Size(max = 64) String timezone,
        @NotBlank @Pattern(regexp = "^(MOBILE_GPS|MANUAL)$", message = "must be MOBILE_GPS or MANUAL") String source
) { }
