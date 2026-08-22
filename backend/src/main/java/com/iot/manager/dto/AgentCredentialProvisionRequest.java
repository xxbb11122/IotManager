package com.iot.manager.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;

/** Creates a pre-provisioned edge agent and its first independently revocable credential. */
public record AgentCredentialProvisionRequest(
        @NotBlank @Size(max = 100) String agentId,
        @NotBlank @Size(max = 64) String siteCode,
        @NotBlank @Size(max = 255) String agentName,
        LocalDateTime expiresAt,
        @Size(max = 1000) String reason
) {
}
