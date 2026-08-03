package com.iot.manager.edgeagent.protocol;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public record AgentHello(
        int protocolVersion,
        UUID messageId,
        Instant sentAt,
        AgentDescriptor agent,
        List<DriverDescriptor> drivers
) implements AgentMessage {
    public AgentHello {
        ProtocolValue.common(protocolVersion, messageId, sentAt);
        agent = Objects.requireNonNull(agent, "agent");
        drivers = ProtocolValue.list(drivers, "drivers");
    }

    @Override
    public AgentMessageType type() {
        return AgentMessageType.HELLO;
    }
}
