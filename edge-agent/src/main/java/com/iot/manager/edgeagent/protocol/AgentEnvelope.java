package com.iot.manager.edgeagent.protocol;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.UUID;

/** Public representation of the JSON envelope, useful to backend implementers. */
public record AgentEnvelope(
        String type,
        int protocolVersion,
        UUID messageId,
        Instant sentAt,
        JsonNode payload
) {
}
