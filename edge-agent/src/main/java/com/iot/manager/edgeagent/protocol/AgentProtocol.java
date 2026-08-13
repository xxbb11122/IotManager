package com.iot.manager.edgeagent.protocol;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

/** Shared protocol constants and JSON settings for the agent/backend WebSocket. */
public final class AgentProtocol {
    public static final int CURRENT_VERSION = 1;

    private AgentProtocol() {
    }

    public static ObjectMapper newObjectMapper() {
        return new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }
}
