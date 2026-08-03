package com.iot.manager.edgeagent.identity;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Stable identity for an installed agent, never regenerated during normal restarts. */
public record AgentIdentity(UUID agentId, Instant createdAt) {
    public AgentIdentity {
        Objects.requireNonNull(agentId, "agentId");
        Objects.requireNonNull(createdAt, "createdAt");
    }
}
