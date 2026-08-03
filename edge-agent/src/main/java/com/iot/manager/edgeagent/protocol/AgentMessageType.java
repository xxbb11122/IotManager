package com.iot.manager.edgeagent.protocol;

import java.util.Arrays;

public enum AgentMessageType {
    HELLO("agent_hello"),
    HEARTBEAT("agent_heartbeat"),
    DISCOVERY_SNAPSHOT("discovery_snapshot"),
    TELEMETRY("telemetry"),
    COMMAND_REQUEST("command_request"),
    COMMAND_RESULT("command_result");

    private final String wireName;

    AgentMessageType(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }

    public static AgentMessageType fromWireName(String value) {
        return Arrays.stream(values())
                .filter(type -> type.wireName.equals(value))
                .findFirst()
                .orElseThrow(() -> new ProtocolException("Unsupported edge protocol message type: " + value));
    }
}
