package com.iot.manager.dto;

import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;

public record AgentCredentialRotateRequest(
        LocalDateTime expiresAt,
        @Size(max = 1000) String reason
) {
}
