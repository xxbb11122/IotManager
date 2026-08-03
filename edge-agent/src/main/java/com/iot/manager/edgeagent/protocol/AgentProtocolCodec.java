package com.iot.manager.edgeagent.protocol;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.List;
import java.util.Objects;

/** Serializes the stable envelope while allowing typed message payload evolution. */
public final class AgentProtocolCodec {
    private static final List<String> COMMON_FIELDS = List.of("protocolVersion", "messageId", "sentAt");

    private final ObjectMapper objectMapper;

    public AgentProtocolCodec() {
        this(AgentProtocol.newObjectMapper());
    }

    public AgentProtocolCodec(ObjectMapper objectMapper) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }

    public ObjectMapper objectMapper() {
        return objectMapper;
    }

    public String encode(AgentMessage message) {
        Objects.requireNonNull(message, "message");
        ObjectNode payload = objectMapper.valueToTree(message);
        payload.remove(COMMON_FIELDS);
        AgentEnvelope envelope = new AgentEnvelope(
                message.type().wireName(),
                message.protocolVersion(),
                message.messageId(),
                message.sentAt(),
                payload
        );
        try {
            return objectMapper.writeValueAsString(envelope);
        } catch (JsonProcessingException exception) {
            throw new ProtocolException("Could not serialize edge protocol message", exception);
        }
    }

    public AgentMessage decode(String json) {
        try {
            AgentEnvelope envelope = objectMapper.readValue(json, AgentEnvelope.class);
            if (envelope.type() == null || envelope.payload() == null) {
                throw new ProtocolException("Edge protocol envelope must contain type and payload");
            }
            if (envelope.protocolVersion() != AgentProtocol.CURRENT_VERSION) {
                throw new ProtocolException("Unsupported edge protocol version: " + envelope.protocolVersion());
            }
            if (envelope.messageId() == null || envelope.sentAt() == null) {
                throw new ProtocolException("Edge protocol envelope must contain messageId and sentAt");
            }

            AgentMessageType type = AgentMessageType.fromWireName(envelope.type());
            if (!envelope.payload().isObject()) {
                throw new ProtocolException("Edge protocol payload must be a JSON object");
            }
            ObjectNode fullPayload = ((ObjectNode) envelope.payload()).deepCopy();
            fullPayload.put("protocolVersion", envelope.protocolVersion());
            fullPayload.put("messageId", envelope.messageId().toString());
            fullPayload.put("sentAt", envelope.sentAt().toString());

            return switch (type) {
                case HELLO -> objectMapper.treeToValue(fullPayload, AgentHello.class);
                case HEARTBEAT -> objectMapper.treeToValue(fullPayload, AgentHeartbeat.class);
                case DISCOVERY_SNAPSHOT -> objectMapper.treeToValue(fullPayload, DiscoverySnapshot.class);
                case TELEMETRY -> objectMapper.treeToValue(fullPayload, TelemetryEvent.class);
                case COMMAND_REQUEST -> objectMapper.treeToValue(fullPayload, CommandRequest.class);
                case COMMAND_RESULT -> objectMapper.treeToValue(fullPayload, CommandResult.class);
            };
        } catch (ProtocolException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ProtocolException("Could not decode edge protocol message", exception);
        }
    }
}
