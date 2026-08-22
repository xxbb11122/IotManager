package com.iot.manager.dto;

import java.time.LocalDateTime;

/** Safe credential representation: no token or hash is ever serialized. */
public record AgentCredentialView(
        String credentialId,
        String agentId,
        Long siteId,
        String siteCode,
        String status,
        LocalDateTime expiresAt,
        LocalDateTime lastUsedAt,
        LocalDateTime revokedAt,
        LocalDateTime createdAt
) {
}
