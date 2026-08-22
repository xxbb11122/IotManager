package com.iot.manager.dto;

import java.time.LocalDateTime;

/** Contains a secret exactly once at creation/rotation time; do not log it. */
public record IssuedAgentCredentialView(
        String credentialId,
        String agentId,
        String siteCode,
        String token,
        LocalDateTime expiresAt,
        LocalDateTime createdAt
) {
}
