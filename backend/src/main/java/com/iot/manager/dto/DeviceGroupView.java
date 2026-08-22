package com.iot.manager.dto;

import java.time.LocalDateTime;

public record DeviceGroupView(
        String groupId,
        Long siteId,
        String siteCode,
        String name,
        String description,
        long version,
        int memberCount,
        int onlineCount,
        LocalDateTime updatedAt,
        LocalDateTime archivedAt
) {
}
