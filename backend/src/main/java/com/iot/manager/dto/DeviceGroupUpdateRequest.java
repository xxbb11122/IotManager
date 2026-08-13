package com.iot.manager.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record DeviceGroupUpdateRequest(
        @NotNull Long expectedVersion,
        @Pattern(regexp = ".*\\S.*", message = "must not be blank") @Size(max = 100) String name,
        @Size(max = 1000) String description
) {
}
