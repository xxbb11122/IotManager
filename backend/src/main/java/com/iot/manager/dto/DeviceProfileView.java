package com.iot.manager.dto;

import java.util.Map;

public record DeviceProfileView(
        String profileId,
        Integer version,
        String displayName,
        String deviceType,
        boolean enabled,
        String definitionHash,
        Map<String, Object> definition
) {

    public DeviceProfileView {
        definition = DeviceView.immutableMap(definition);
    }
}
