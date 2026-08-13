package com.iot.manager.websocket;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.ClaimLanDeviceRequest;
import com.iot.manager.dto.DeviceCommandRequest;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.dto.DeviceProfileView;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.entity.DiscoveredDevice;
import com.iot.manager.entity.EdgeAgent;
import com.iot.manager.repository.DeviceCommandRepository;
import com.iot.manager.repository.DiscoveredDeviceRepository;
import com.iot.manager.repository.EdgeAgentRepository;
import com.iot.manager.service.CommandService;
import com.iot.manager.service.EdgeAgentService;
import com.iot.manager.service.EdgeDiscoveryService;
import com.iot.manager.service.DeviceProfileService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class EdgeAgentWebSocketIntegrationTest {

    private static final String SITE_CODE = "demo-site";
    private static final String DRIVER_ID = "shelly-plus-plug-s-rpc-v1";
    private static final String PROFILE_ID = "shelly-plus-plug-s-v1";

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private EdgeAgentRepository edgeAgentRepository;

    @Autowired
    private DiscoveredDeviceRepository discoveredDeviceRepository;

    @Autowired
    private DeviceCommandRepository deviceCommandRepository;

    @Autowired
    private EdgeDiscoveryService edgeDiscoveryService;

    @Autowired
    private EdgeAgentService edgeAgentService;

    @Autowired
    private CommandService commandService;

    @Autowired
    private DeviceProfileService deviceProfileService;

    private final List<AgentSocket> sockets = new ArrayList<>();

    @AfterEach
    void closeSockets() {
        sockets.forEach(AgentSocket::close);
        sockets.clear();
    }

    @Test
    void acceptsHelloPersistsLanDiscoveryClaimsDeviceAndAcknowledgesCommandOverWebSocket() throws Exception {
        ClaimedAgent agent = connectAndClaimShelly();

        DeviceCommandView submitted = commandService.submit(agent.deviceId(), new DeviceCommandRequest(
                "set_power", "edge-ack-" + UUID.randomUUID(), Map.of("on", true)
        ));
        assertThat(submitted.source()).isEqualTo("EDGE_AGENT");
        assertThat(submitted.status()).isEqualTo("PENDING");

        edgeAgentService.dispatchPendingCommands();
        JsonNode request = agent.socket().awaitMessage("command_request");
        assertThat(request.path("protocolVersion").asInt()).isEqualTo(1);
        assertThat(request.path("payload").path("commandId").asText()).isEqualTo(submitted.commandId());
        assertThat(request.path("payload").path("driverId").asText()).isEqualTo(DRIVER_ID);
        assertThat(request.path("payload").path("endpoint").asText()).isEqualTo(agent.endpoint());
        assertThat(request.path("payload").path("command").asText()).isEqualTo("set_power");
        assertThat(request.path("payload").path("parameters").path("on").asBoolean()).isTrue();

        agent.socket().send(envelope("command_result", commandResultPayload(
                submitted.commandId(), agent.deviceKey(), "ACKNOWLEDGED", Map.of("power", true, "powerWatts", 41.2), null, null
        )));

        DeviceCommandView completed = awaitCommandStatus(submitted.commandId(), "ACKNOWLEDGED");
        assertThat(completed.reportedState()).containsEntry("power", true);
        assertThat(completed.failureCode()).isNull();
    }

    @Test
    void shellyProfileUsesTheSameIdentityContractAsTheEdgeDriver() {
        DeviceProfileView profile = deviceProfileService.get(PROFILE_ID, 1);
        Object rawIdentity = profile.definition().get("identity");
        assertThat(rawIdentity).isInstanceOf(Map.class);
        Map<?, ?> identity = (Map<?, ?>) rawIdentity;

        assertThat(String.valueOf(identity.get("driverId"))).isEqualTo(DRIVER_ID);
        assertThat(String.valueOf(identity.get("app"))).isEqualTo("PlusPlugS");
        assertThat(String.valueOf(identity.get("modelPrefix"))).isEqualTo("SNPL-00116");
    }

    @Test
    void retainsFailedAgentResultAndMarksExpiredSentCommandUnconfirmed() throws Exception {
        ClaimedAgent agent = connectAndClaimShelly();

        DeviceCommandView failed = dispatch(agent, false, "edge-failed-");
        agent.socket().send(envelope("command_result", commandResultPayload(
                failed.commandId(), agent.deviceKey(), "FAILED", Map.of(), "SHELLY_IO", "Unable to reach the plug"
        )));
        DeviceCommandView failedResult = awaitCommandStatus(failed.commandId(), "FAILED");
        assertThat(failedResult.failureCode()).isEqualTo("SHELLY_IO");
        assertThat(failedResult.error()).isEqualTo("Unable to reach the plug");

        DeviceCommandView timedOut = dispatch(agent, true, "edge-timeout-");
        var expiredCommand = deviceCommandRepository.findByCommandId(timedOut.commandId()).orElseThrow();
        expiredCommand.setExpiresAt(LocalDateTime.now().minusSeconds(1));
        deviceCommandRepository.saveAndFlush(expiredCommand);
        edgeAgentService.markExpiredCommandsUnconfirmed();

        DeviceCommandView unconfirmed = awaitCommandStatus(timedOut.commandId(), "UNCONFIRMED");
        assertThat(unconfirmed.failureCode()).isEqualTo("CONFIRMATION_TIMEOUT");
        assertThat(unconfirmed.error()).contains("did not return a confirmation");
    }

    @Test
    void refusesCommandResultFromAnotherConnectedAgent() throws Exception {
        ClaimedAgent owner = connectAndClaimShelly();
        AgentSocket intruder = connect();
        String intruderId = "edge-intruder-" + UUID.randomUUID();
        intruder.send(envelope("agent_hello", helloPayload(intruderId, "Unrelated integration agent")));
        awaitValue(() -> edgeAgentRepository.findByAgentId(intruderId));

        DeviceCommandView submitted = dispatch(owner, true, "edge-ownership-");
        intruder.send(envelope("command_result", commandResultPayload(
                submitted.commandId(), owner.deviceKey(), "ACKNOWLEDGED", Map.of("power", true), null, null
        )));

        assertStatusRemains(submitted.commandId(), "SENT", 750);

        owner.socket().send(envelope("command_result", commandResultPayload(
                submitted.commandId(), owner.deviceKey(), "ACKNOWLEDGED", Map.of("power", true), null, null
        )));
        assertThat(awaitCommandStatus(submitted.commandId(), "ACKNOWLEDGED").reportedState())
                .containsEntry("power", true);
    }

    private DeviceCommandView dispatch(ClaimedAgent agent, boolean on, String keyPrefix) throws Exception {
        DeviceCommandView submitted = commandService.submit(agent.deviceId(), new DeviceCommandRequest(
                "set_power", keyPrefix + UUID.randomUUID(), Map.of("on", on)
        ));
        edgeAgentService.dispatchPendingCommands();
        JsonNode request = agent.socket().awaitMessage("command_request");
        assertThat(request.path("payload").path("commandId").asText()).isEqualTo(submitted.commandId());
        assertThat(awaitCommandStatus(submitted.commandId(), "SENT").sentAt()).isNotNull();
        return submitted;
    }

    private ClaimedAgent connectAndClaimShelly() throws Exception {
        AgentSocket socket = connect();
        String agentId = "edge-integration-" + UUID.randomUUID();
        String deviceKey = "shelly:" + UUID.randomUUID().toString().replace("-", "").toUpperCase();
        String endpoint = "http://192.0.2.20";

        socket.send(envelope("agent_hello", helloPayload(agentId, "Integration Shelly Agent")));

        EdgeAgent edgeAgent = awaitValue(() -> edgeAgentRepository.findByAgentId(agentId));
        assertThat(edgeAgent.getStatus()).isEqualTo("ONLINE");

        socket.send(envelope("discovery_snapshot", Map.of(
                "siteCode", SITE_CODE,
                "devices", List.of(Map.of(
                        "deviceKey", deviceKey,
                        "driverId", DRIVER_ID,
                        "profileId", PROFILE_ID,
                        "displayName", "Shelly Plus Plug S Integration",
                        "endpoint", endpoint,
                        "identity", Map.of(
                                "manufacturer", "Shelly",
                                "app", "PlusPlugS",
                                "model", "SNPL-00116EU"
                        ),
                        "reportedState", Map.of("power", false, "voltage", 230.1, "powerWatts", 0.0),
                        "observedAt", Instant.now().toString()
                ))
        )));

        DiscoveredDevice candidate = awaitValue(() -> discoveredDeviceRepository.findByAgentIdAndExternalId(edgeAgent.getId(), deviceKey));
        assertThat(candidate.getStatus()).isEqualTo("DISCOVERED");
        assertThat(candidate.getProfileId()).isEqualTo(PROFILE_ID);
        assertThat(candidate.getModel()).isEqualTo("SNPL-00116EU");

        DeviceView device = edgeDiscoveryService.claim(candidate.getCandidateId(), new ClaimLanDeviceRequest(
                SITE_CODE, "/operations/field", "Claimed Shelly " + UUID.randomUUID()
        ));
        return new ClaimedAgent(socket, device.id(), deviceKey, endpoint);
    }

    private Map<String, Object> helloPayload(String agentId, String agentName) {
        return Map.of(
                "agent", Map.of(
                        "agentId", agentId,
                        "agentName", agentName,
                        "siteCode", SITE_CODE,
                        "softwareVersion", "test"
                ),
                "drivers", List.of(Map.of(
                        "driverId", DRIVER_ID,
                        "driverVersion", "test",
                        "profileIds", List.of(PROFILE_ID)
                ))
        );
    }

    private AgentSocket connect() throws Exception {
        AgentSocketListener listener = new AgentSocketListener();
        WebSocket socket = HttpClient.newHttpClient()
                .newWebSocketBuilder()
                .buildAsync(URI.create("ws://localhost:" + port + "/ws/edge/v1"), listener)
                .get(5, TimeUnit.SECONDS);
        AgentSocket agentSocket = new AgentSocket(socket, listener.messages);
        sockets.add(agentSocket);
        return agentSocket;
    }

    private DeviceCommandView awaitCommandStatus(String commandId, String status) throws Exception {
        return awaitValue(() -> {
            DeviceCommandView command = commandService.getByCommandId(commandId);
            return status.equals(command.status()) ? Optional.of(command) : Optional.empty();
        });
    }

    private void assertStatusRemains(String commandId, String expectedStatus, long durationMillis) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(durationMillis);
        while (System.nanoTime() < deadline) {
            assertThat(commandService.getByCommandId(commandId).status()).isEqualTo(expectedStatus);
            Thread.sleep(25);
        }
    }

    private <T> T awaitValue(Supplier<Optional<T>> supplier) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (System.nanoTime() < deadline) {
            Optional<T> value = supplier.get();
            if (value.isPresent()) {
                return value.get();
            }
            Thread.sleep(20);
        }
        throw new AssertionError("Timed out waiting for asynchronous edge-agent operation");
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

    private Map<String, Object> commandResultPayload(
            String commandId,
            String deviceKey,
            String status,
            Map<String, Object> reportedState,
            String errorCode,
            String errorMessage
    ) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("commandId", commandId);
        payload.put("deviceKey", deviceKey);
        payload.put("status", status);
        payload.put("reportedState", reportedState);
        payload.put("errorCode", errorCode);
        payload.put("errorMessage", errorMessage);
        payload.put("completedAt", Instant.now().toString());
        return payload;
    }

    private record ClaimedAgent(AgentSocket socket, Long deviceId, String deviceKey, String endpoint) {
    }

    private final class AgentSocket implements AutoCloseable {
        private final WebSocket socket;
        private final BlockingQueue<String> messages;

        private AgentSocket(WebSocket socket, BlockingQueue<String> messages) {
            this.socket = socket;
            this.messages = messages;
        }

        private void send(Map<String, Object> message) throws Exception {
            socket.sendText(objectMapper.writeValueAsString(message), true).get(5, TimeUnit.SECONDS);
        }

        private JsonNode awaitMessage(String type) throws Exception {
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (System.nanoTime() < deadline) {
                String raw = messages.poll(100, TimeUnit.MILLISECONDS);
                if (raw == null) {
                    continue;
                }
                JsonNode message = objectMapper.readTree(raw);
                if (type.equals(message.path("type").asText())) {
                    return message;
                }
            }
            throw new AssertionError("Timed out waiting for edge WebSocket message type " + type);
        }

        @Override
        public void close() {
            try {
                socket.sendClose(WebSocket.NORMAL_CLOSURE, "test complete").get(2, TimeUnit.SECONDS);
            } catch (Exception ignored) {
                socket.abort();
            }
        }
    }

    private static final class AgentSocketListener implements WebSocket.Listener {
        private final BlockingQueue<String> messages = new LinkedBlockingQueue<>();
        private final StringBuilder buffer = new StringBuilder();

        @Override
        public void onOpen(WebSocket webSocket) {
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            buffer.append(data);
            if (last) {
                messages.offer(buffer.toString());
                buffer.setLength(0);
            }
            webSocket.request(1);
            return CompletableFuture.completedFuture(null);
        }
    }
}
