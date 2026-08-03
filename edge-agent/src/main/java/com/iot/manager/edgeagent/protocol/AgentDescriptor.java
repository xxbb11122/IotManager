package com.iot.manager.edgeagent.protocol;

import java.util.UUID;

/** Metadata reported by the running process; the UUID comes from the durable identity store. */
public record AgentDescriptor(UUID agentId, String agentName, String siteCode, String softwareVersion) {
    public AgentDescriptor {
        if (agentId == null) {
            throw new IllegalArgumentException("agentId must not be null");
        }
        agentName = ProtocolValue.text(agentName, "agentName");
        siteCode = ProtocolValue.text(siteCode, "siteCode");
        softwareVersion = ProtocolValue.text(softwareVersion, "softwareVersion");
    }
}
