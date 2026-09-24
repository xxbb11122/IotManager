package com.iot.manager.dto;

import jakarta.validation.constraints.Future;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public record RetentionHoldRequest(
        @NotBlank @Size(max = 40) String scopeType,
        @NotBlank @Size(max = 255) String scopeId,
        @Future Instant endsAt,
        @NotBlank @Size(max = 1000) String reason
) { }
