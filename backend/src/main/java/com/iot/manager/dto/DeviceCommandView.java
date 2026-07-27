package com.iot.manager.dto;

import java.time.LocalDateTime;
import java.util.Map;

public record DeviceCommandView(
        String commandId,
        Long deviceId,
        String type,
        String source,
        String status,
        Map<String, Object> parameters,
        Map<String, Object> desiredState,
        Map<String, Object> reportedState,
        Map<String, Object> result,
        String error,
        LocalDateTime requestedAt,
        LocalDateTime acknowledgedAt
    ) {

    public DeviceCommandView {
        parameters = DeviceView.immutableMap(parameters);
        desiredState = DeviceView.immutableMap(desiredState);
        reportedState = DeviceView.immutableMap(reportedState);
        result = DeviceView.immutableMap(result);
    }
}
