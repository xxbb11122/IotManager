package com.iot.manager.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.Map;

public record CommandBatchRequest(
        @NotBlank @Size(max = 64) String siteCode,
        @NotNull @Valid CommandBatchTarget target,
        @NotBlank @Size(max = 100) String type,
        @NotBlank @Size(max = 128) String idempotencyKey,
        Map<String, Object> parameters,
        Integer expiresInSeconds
) {
}
