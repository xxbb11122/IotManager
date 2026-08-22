package com.iot.manager.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.AgentCredentialProvisionRequest;
import com.iot.manager.repository.EdgeAgentRepository;
import com.iot.manager.service.AgentCredentialService;
import com.iot.manager.service.BootstrapService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Exercises the secure edge handshake and the credential-to-agent binding. */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "iot.security.enabled=true",
                "iot.web.allowed-origins[0]=https://iot.example.test"
        }
)
@ActiveProfiles("test")
@Import(SecureEdgeAgentWebSocketIntegrationTest.JwtDecoderConfiguration.class)
class SecureEdgeAgentWebSocketIntegrationTest {

    @LocalServerPort
    private int port;

    @org.springframework.beans.factory.annotation.Autowired
    private ObjectMapper objectMapper;

    @org.springframework.beans.factory.annotation.Autowired
    private BootstrapService bootstrapService;

    @org.springframework.beans.factory.annotation.Autowired
    private AgentCredentialService credentialService;

    @org.springframework.beans.factory.annotation.Autowired
    private EdgeAgentRepository agentRepository;

    private final List<WebSocket> sockets = new ArrayList<>();

    @AfterEach
    void closeSockets() {
        sockets.forEach(socket -> {
            try {
                socket.sendClose(WebSocket.NORMAL_CLOSURE, "test complete").get(2, TimeUnit.SECONDS);
            } catch (Exception ignored) {
                socket.abort();
            }
        });
        sockets.clear();
    }

    @Test
    void acceptsProvisionedCredentialAndRejectsWrongSecretBeforeUpgrade() throws Exception {
        var site = bootstrapService.ensureDemoContext().getSite();
        String agentId = "secure-edge-" + UUID.randomUUID();
        var issued = credentialService.provision(site, new AgentCredentialProvisionRequest(
                agentId, site.getCode(), "Secure integration agent", null, "integration"
        ), "security-test-admin");

        WebSocket socket = connect(issued.credentialId(), issued.token());
        socket.sendText(objectMapper.writeValueAsString(envelope("agent_hello", Map.of(
                "agent", Map.of(
                        "agentId", agentId,
                        "agentName", "Secure integration agent",
                        "siteCode", site.getCode(),
                        "softwareVersion", "test"
                ),
                "drivers", List.of()
        ))), true).get(5, TimeUnit.SECONDS);
        await(() -> agentRepository.findByAgentId(agentId)
                .map(agent -> "ONLINE".equals(agent.getStatus()))
                .orElse(false));

        assertThatThrownBy(() -> connect(issued.credentialId(), "wrong-secret"))
                .isInstanceOf(Exception.class);
    }

    private WebSocket connect(String credentialId, String token) throws Exception {
        WebSocket socket = HttpClient.newHttpClient().newWebSocketBuilder()
                .header(EdgeAgentCredentialHandshakeInterceptor.CREDENTIAL_HEADER, credentialId)
                .header(EdgeAgentCredentialHandshakeInterceptor.TOKEN_HEADER, token)
                .buildAsync(URI.create("ws://localhost:" + port + "/ws/edge/v1"), new NoopListener())
                .get(5, TimeUnit.SECONDS);
        sockets.add(socket);
        return socket;
    }

    private Map<String, Object> envelope(String type, Map<String, Object> payload) {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("type", type);
        envelope.put("protocolVersion", 1);
        envelope.put("messageId", UUID.randomUUID().toString());
        envelope.put("sentAt", Instant.now().toString());
        envelope.put("payload", payload);
        return envelope;
    }

    private void await(BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (System.nanoTime() < deadline) {
            if (condition.getAsBoolean()) return;
            Thread.sleep(25);
        }
        assertThat(condition.getAsBoolean()).isTrue();
    }

    private static final class NoopListener implements WebSocket.Listener {
        @Override
        public void onOpen(WebSocket webSocket) {
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            webSocket.request(1);
            return CompletableFuture.completedFuture(null);
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class JwtDecoderConfiguration {
        @Bean
        JwtDecoder jwtDecoder() {
            return token -> Jwt.withTokenValue(token)
                    .header("alg", "none")
                    .subject("secure-edge-test-user")
                    .issuedAt(Instant.now().minusSeconds(5))
                    .expiresAt(Instant.now().plusSeconds(300))
                    .claim("preferred_username", "secure-edge-test")
                    .claim("realm_access", Map.of("roles", List.of("ADMIN")))
                    .build();
        }
    }
}
