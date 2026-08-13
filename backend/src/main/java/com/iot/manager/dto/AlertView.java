package com.iot.manager.dto;

import java.time.LocalDateTime;

public record AlertView(
        Long id,
        Long deviceId,
        String deviceName,
        String devicePublicId,
        String level,
        String status,
        String alertCode,
        String message,
        LocalDateTime createdAt,
        LocalDateTime acknowledgedAt,
        LocalDateTime resolvedAt
) {
}
