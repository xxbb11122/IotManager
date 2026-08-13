package com.iot.manager.edgeagent.driver;

import java.net.URI;
import java.util.Map;
import java.util.Objects;

/** A driver-local representation of a platform command. */
public record DeviceCommand(
        String commandId,
        String deviceKey,
        URI endpoint,
        String command,
        Map<String, Object> parameters
) {
    public DeviceCommand {
        commandId = text(commandId, "commandId");
        deviceKey = text(deviceKey, "deviceKey");
        endpoint = Objects.requireNonNull(endpoint, "endpoint");
        command = text(command, "command");
        parameters = Map.copyOf(Objects.requireNonNull(parameters, "parameters"));
    }

    private static String text(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value.trim();
    }
}
