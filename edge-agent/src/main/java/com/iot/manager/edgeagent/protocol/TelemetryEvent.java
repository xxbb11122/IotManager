package com.iot.manager.edgeagent.protocol;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record TelemetryEvent(
        int protocolVersion,
        UUID messageId,
        Instant sentAt,
        List<TelemetrySample> samples
) implements AgentMessage {
    public TelemetryEvent {
        ProtocolValue.common(protocolVersion, messageId, sentAt);
        samples = ProtocolValue.list(samples, "samples");
    }

    @Override
    public AgentMessageType type() {
        return AgentMessageType.TELEMETRY;
    }
}
