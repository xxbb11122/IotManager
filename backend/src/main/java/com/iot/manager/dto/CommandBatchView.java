package com.iot.manager.dto;

import java.time.LocalDateTime;

public record CommandBatchView(
        String batchId,
        Long siteId,
        String siteCode,
        String groupId,
        String targetKind,
        String targetLabel,
        String type,
        String status,
        int totalCount,
        int pendingCount,
        int sentCount,
        int acknowledgedCount,
        int failedCount,
        int rejectedCount,
        LocalDateTime requestedAt,
        LocalDateTime completedAt,
        LocalDateTime expiresAt
) {
}
