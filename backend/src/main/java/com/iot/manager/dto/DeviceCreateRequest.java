package com.iot.manager.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record DeviceCreateRequest(
        @NotBlank @Size(max = 100) String name,
        @NotBlank @Size(max = 50) String type,
        @NotBlank @Size(max = 50) String protocol,
        @Size(max = 255) String location,
        @Size(max = 255) String firmwareVersion,
        @Pattern(
                regexp = "^(ONLINE|OFFLINE|WARNING|MAINTENANCE)$",
                message = "must be one of ONLINE, OFFLINE, WARNING, MAINTENANCE"
        ) @Size(max = 20) String status
) {
}
