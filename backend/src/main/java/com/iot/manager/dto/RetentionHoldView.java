package com.iot.manager.dto;

import java.time.Instant;

public record RetentionHoldView(
        Long id,
        String scopeType,
        String scopeId,
        Instant startsAt,
        Instant endsAt,
        String reason,
        String createdBy,
        Instant createdAt,
        String releasedBy,
        Instant releasedAt,
        boolean active
) { }
