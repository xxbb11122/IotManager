package com.iot.manager.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record DeviceGroupCreateRequest(
        @NotBlank @Size(max = 64) String siteCode,
        @NotBlank @Size(max = 100) String name,
        @Size(max = 1000) String description
) {
}
