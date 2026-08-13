package com.iot.manager.edgeagent.identity;

import com.iot.manager.edgeagent.protocol.AgentProtocol;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentIdentityStoreTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void createsOneStableIdentityForTheInstallation() throws Exception {
        Path identityFile = temporaryDirectory.resolve("state").resolve("identity.json");
        AgentIdentityStore store = new AgentIdentityStore(
                AgentProtocol.newObjectMapper(),
                Clock.fixed(Instant.parse("2026-08-03T10:15:30Z"), ZoneOffset.UTC)
        );

        AgentIdentity first = store.loadOrCreate(identityFile);
        AgentIdentity second = store.loadOrCreate(identityFile);

        assertEquals(first, second);
        assertEquals(Instant.parse("2026-08-03T10:15:30Z"), first.createdAt());
        assertTrue(Files.readString(identityFile).contains(first.agentId().toString()));
    }
}
