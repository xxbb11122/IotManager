package com.iot.manager.dto;

import java.time.LocalDateTime;
import java.util.Map;

public record ActivityView(
        Long id,
        String eventType,
        String detail,
        Map<String, Object> payload,
        LocalDateTime occurredAt,
        Long actorId,
        Long organizationId,
        Long siteId
) {

    public ActivityView {
        payload = DeviceView.immutableMap(payload);
    }
}
