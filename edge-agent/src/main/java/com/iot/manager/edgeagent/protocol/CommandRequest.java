package com.iot.manager.edgeagent.protocol;

import java.net.URI;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Inbound command from the platform. commandId is the agent-facing idempotency key. */
public record CommandRequest(
        int protocolVersion,
        UUID messageId,
        Instant sentAt,
        String commandId,
        String deviceKey,
        String driverId,
        URI endpoint,
        String command,
        Map<String, Object> parameters,
        Instant expiresAt
) implements AgentMessage {
    public CommandRequest {
        ProtocolValue.common(protocolVersion, messageId, sentAt);
        commandId = ProtocolValue.text(commandId, "commandId");
        deviceKey = ProtocolValue.text(deviceKey, "deviceKey");
        driverId = ProtocolValue.text(driverId, "driverId");
        endpoint = Objects.requireNonNull(endpoint, "endpoint");
        command = ProtocolValue.text(command, "command");
        parameters = ProtocolValue.map(parameters, "parameters");
    }

    @Override
    public AgentMessageType type() {
        return AgentMessageType.COMMAND_REQUEST;
    }
}
