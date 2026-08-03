package com.iot.manager.edgeagent.protocol;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record DiscoverySnapshot(
        int protocolVersion,
        UUID messageId,
        Instant sentAt,
        String siteCode,
        List<DiscoveredDevice> devices
) implements AgentMessage {
    public DiscoverySnapshot {
        ProtocolValue.common(protocolVersion, messageId, sentAt);
        siteCode = ProtocolValue.text(siteCode, "siteCode");
        devices = ProtocolValue.list(devices, "devices");
    }

    @Override
    public AgentMessageType type() {
        return AgentMessageType.DISCOVERY_SNAPSHOT;
    }
}
