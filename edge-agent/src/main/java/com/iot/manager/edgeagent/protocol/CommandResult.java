package com.iot.manager.edgeagent.protocol;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public record CommandResult(
        int protocolVersion,
        UUID messageId,
        Instant sentAt,
        String commandId,
        String deviceKey,
        CommandStatus status,
        Map<String, Object> reportedState,
        String errorCode,
        String errorMessage,
        Instant completedAt
) implements AgentMessage {
    public CommandResult {
        ProtocolValue.common(protocolVersion, messageId, sentAt);
        commandId = ProtocolValue.text(commandId, "commandId");
        deviceKey = ProtocolValue.text(deviceKey, "deviceKey");
        status = Objects.requireNonNull(status, "status");
        reportedState = ProtocolValue.map(reportedState, "reportedState");
        completedAt = Objects.requireNonNull(completedAt, "completedAt");
    }

    @Override
    public AgentMessageType type() {
        return AgentMessageType.COMMAND_RESULT;
    }
}
