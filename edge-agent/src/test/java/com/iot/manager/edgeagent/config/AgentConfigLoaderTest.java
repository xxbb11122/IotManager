package com.iot.manager.edgeagent.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentConfigLoaderTest {

    @TempDir
    Path tempDirectory;

    @Test
    void loadsIndependentCredentialPairAndResolvesIdentityPath() throws Exception {
        Path configFile = tempDirectory.resolve("edge-agent.properties");
        Files.writeString(configFile, """
                agent.name=plant-edge-01
                agent.site-code=demo-site
                agent.identity-file=./identity.json
                backend.websocket.url=wss://iot.example.test/ws/edge/v1
                backend.websocket.access-token=
                backend.websocket.credential-id=agentcred-01
                backend.websocket.credential-token=iat-secret
                """);

        AgentConfig config = AgentConfigLoader.load(configFile);

        assertEquals("agentcred-01", config.agentCredentialId());
        assertEquals("iat-secret", config.agentCredentialToken());
        assertEquals(tempDirectory.resolve("identity.json").toAbsolutePath(), config.identityFile());
        assertEquals("wss", config.backendWebSocketUri().getScheme());
    }

    @Test
    void rejectsOnlyHalfOfTheCredentialPair() throws Exception {
        Path configFile = tempDirectory.resolve("edge-agent.properties");
        Files.writeString(configFile, """
                agent.name=plant-edge-01
                agent.site-code=demo-site
                agent.identity-file=identity.json
                backend.websocket.url=ws://localhost:8080/ws/edge/v1
                backend.websocket.credential-id=agentcred-01
                """);

        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class, () -> AgentConfigLoader.load(configFile)
        );
        assertTrue(exception.getMessage().contains("provided together"));
    }
}
