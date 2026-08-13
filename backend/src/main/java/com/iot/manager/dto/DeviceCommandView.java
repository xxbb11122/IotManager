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
        LocalDateTime acknowledgedAt,
        String batchId,
        Long sequenceNo,
        String requestOrigin,
        String failureCode,
        LocalDateTime sentAt,
        LocalDateTime completedAt
    ) {

    public DeviceCommandView {
        parameters = DeviceView.immutableMap(parameters);
        desiredState = DeviceView.immutableMap(desiredState);
        reportedState = DeviceView.immutableMap(reportedState);
        result = DeviceView.immutableMap(result);
    }
}
