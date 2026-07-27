package com.iot.manager.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.Map;

public record DeviceCommandRequest(
        @NotBlank @Size(max = 100) String type,
        @NotBlank @Size(max = 128) String idempotencyKey,
        Map<String, Object> parameters
) {

    public DeviceCommandRequest {
        parameters = DeviceView.immutableMap(parameters);
    }
}
