package com.iot.manager.edgeagent.driver;

import com.iot.manager.edgeagent.protocol.CommandStatus;

import java.util.Map;
import java.util.Objects;

/** Terminal result returned by a physical-device driver. */
public record DriverCommandResult(
        CommandStatus status,
        Map<String, Object> reportedState,
        String errorCode,
        String errorMessage
) {
    public DriverCommandResult {
        status = Objects.requireNonNull(status, "status");
        if (status == CommandStatus.REJECTED) {
            throw new IllegalArgumentException("DriverCommandResult must not use REJECTED; reject before invoking a driver");
        }
        reportedState = Map.copyOf(Objects.requireNonNull(reportedState, "reportedState"));
    }

    public static DriverCommandResult acknowledged(Map<String, Object> reportedState) {
        return new DriverCommandResult(CommandStatus.ACKNOWLEDGED, reportedState, null, null);
    }

    public static DriverCommandResult failed(String errorCode, String errorMessage, Map<String, Object> reportedState) {
        return new DriverCommandResult(CommandStatus.FAILED, reportedState, errorCode, errorMessage);
    }

    public static DriverCommandResult unconfirmed(String errorCode, String errorMessage, Map<String, Object> reportedState) {
        return new DriverCommandResult(CommandStatus.UNCONFIRMED, reportedState, errorCode, errorMessage);
    }
}
