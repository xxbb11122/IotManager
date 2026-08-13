package com.iot.manager.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ClaimLanDeviceRequest(
        @NotBlank @Size(max = 64) String siteCode,
        @NotBlank @Size(max = 512) String spacePath,
        @NotBlank @Size(max = 100) String displayName
) {
}
