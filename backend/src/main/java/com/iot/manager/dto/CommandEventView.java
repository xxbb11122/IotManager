package com.iot.manager.dto;

import java.time.LocalDateTime;
import java.util.Map;

public record CommandEventView(
        Long id,
        String fromStatus,
        String toStatus,
        String eventType,
        String detail,
        Map<String, Object> payload,
        LocalDateTime occurredAt,
        Long actorId,
        Long organizationId,
        Long siteId
) {

    public CommandEventView {
        payload = DeviceView.immutableMap(payload);
    }
}
