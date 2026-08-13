package com.iot.manager.edgeagent.driver;

import com.iot.manager.edgeagent.protocol.CommandStatus;

/** A classified local-driver failure that can safely be sent back to the platform. */
public class DeviceDriverException extends Exception {
    private final CommandStatus status;
    private final String errorCode;

    public DeviceDriverException(CommandStatus status, String errorCode, String message) {
        super(message);
        this.status = status;
        this.errorCode = errorCode;
    }

    public DeviceDriverException(CommandStatus status, String errorCode, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
        this.errorCode = errorCode;
    }

    public CommandStatus status() {
        return status;
    }

    public String errorCode() {
        return errorCode;
    }

    public static DeviceDriverException rejected(String errorCode, String message) {
        return new DeviceDriverException(CommandStatus.REJECTED, errorCode, message);
    }

    public static DeviceDriverException failed(String errorCode, String message, Throwable cause) {
        return new DeviceDriverException(CommandStatus.FAILED, errorCode, message, cause);
    }

    public static DeviceDriverException unconfirmed(String errorCode, String message, Throwable cause) {
        return new DeviceDriverException(CommandStatus.UNCONFIRMED, errorCode, message, cause);
    }
}
