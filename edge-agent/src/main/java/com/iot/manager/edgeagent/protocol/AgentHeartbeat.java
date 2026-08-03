package com.iot.manager.edgeagent.protocol;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record AgentHeartbeat(
        int protocolVersion,
        UUID messageId,
        Instant sentAt,
        String status,
        Map<String, Object> metrics
) implements AgentMessage {
    public AgentHeartbeat {
        ProtocolValue.common(protocolVersion, messageId, sentAt);
        status = ProtocolValue.text(status, "status");
        metrics = ProtocolValue.map(metrics, "metrics");
    }

    @Override
    public AgentMessageType type() {
        return AgentMessageType.HEARTBEAT;
    }
}
