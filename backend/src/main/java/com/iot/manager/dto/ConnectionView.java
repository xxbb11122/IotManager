package com.iot.manager.dto;

import java.util.Map;

public record ConnectionView(
        String transport,
        String profileId,
        String externalId,
        String status,
        Map<String, Object> metadata
) {

    public ConnectionView {
        metadata = DeviceView.immutableMap(metadata);
    }
}
