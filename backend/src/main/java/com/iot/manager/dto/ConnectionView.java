package com.iot.manager.dto;

import java.util.Map;

public record ConnectionView(
        String transport,
        String profileId,
        Integer profileVersion,
        String externalId,
        String status,
        String agentId,
        String driverId,
        Map<String, Object> metadata
) {

    public ConnectionView {
        metadata = DeviceView.immutableMap(metadata);
    }
}
