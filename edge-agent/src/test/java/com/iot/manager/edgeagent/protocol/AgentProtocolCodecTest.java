package com.iot.manager.edgeagent.protocol;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentProtocolCodecTest {
    @Test
    void roundTripsHelloThroughTheVersionedEnvelope() {
        AgentHello original = new AgentHello(
                AgentProtocol.CURRENT_VERSION,
                UUID.fromString("2c5d47e8-9bd0-48cb-baf6-9dd706a529f0"),
                Instant.parse("2026-08-03T10:00:00Z"),
                new AgentDescriptor(
                        UUID.fromString("7d1e7b76-4d7a-4dbe-b822-5f2c98bf5e39"),
                        "plant-edge-01",
                        "demo-site",
                        "0.1.0-SNAPSHOT"
                ),
                List.of(new DriverDescriptor("shelly-plus-plug-s-gen2-v1", "0.1.0", List.of("shelly-plus-plug-s-gen2-v1")))
        );
        AgentProtocolCodec codec = new AgentProtocolCodec();

        String encoded = codec.encode(original);
        AgentHello decoded = assertInstanceOf(AgentHello.class, codec.decode(encoded));

        assertTrue(encoded.contains("\"type\":\"agent_hello\""));
        assertEquals(original, decoded);
    }
}
