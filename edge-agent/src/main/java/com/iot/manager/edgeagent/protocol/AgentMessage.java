package com.iot.manager.edgeagent.protocol;

import java.time.Instant;
import java.util.UUID;

/** A versioned, typed message carried in an edge WebSocket envelope. */
public sealed interface AgentMessage permits AgentHello, AgentHeartbeat, DiscoverySnapshot,
        TelemetryEvent, CommandRequest, CommandResult {
    AgentMessageType type();

    int protocolVersion();

    UUID messageId();

    Instant sentAt();
}
