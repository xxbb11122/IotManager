package com.iot.manager.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceCommand;
import com.iot.manager.entity.DeviceConnection;
import com.iot.manager.entity.DiscoveredDevice;
import com.iot.manager.entity.EdgeAgent;
import com.iot.manager.entity.Alert;
import com.iot.manager.entity.ObservedTimeTrust;
import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import com.iot.manager.config.IotSecurityProperties;
import com.iot.manager.config.TimeProperties;
import com.iot.manager.repository.DeviceCommandRepository;
import com.iot.manager.repository.DeviceConnectionRepository;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.DiscoveredDeviceRepository;
import com.iot.manager.repository.EdgeAgentRepository;
import com.iot.manager.repository.AlertRepository;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.websocket.EdgeAgentCredentialHandshakeInterceptor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.net.URI;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
@Slf4j
public class EdgeAgentService {

    private static final String DEMO_ORGANIZATION_CODE = "demo-org";
    private static final int PROTOCOL_VERSION = 1;

    private final EdgeAgentRepository agentRepository;
    private final AlertRepository alertRepository;
    private final DiscoveredDeviceRepository discoveredRepository;
    private final DeviceConnectionRepository connectionRepository;
    private final DeviceRepository deviceRepository;
    private final DeviceCommandRepository commandRepository;
    private final OrganizationRepository organizationRepository;
    private final SiteRepository siteRepository;
    private final BootstrapService bootstrapService;
    private final CommandService commandService;
    private final TelemetryService telemetryService;
    private final WebSocketService webSocketService;
    private final ObjectMapper objectMapper;
    private final IotSecurityProperties securityProperties;
    private final AgentCredentialService credentialService;
    private final ScheduledDatabaseTaskGuard scheduledDatabaseTaskGuard;
    private final TimeProvider timeProvider;
    private final TimeProperties timeProperties;
    private final PlatformMetricsService platformMetricsService;

    private final Map<String, WebSocketSession> sessionsByAgentId = new ConcurrentHashMap<>();
    private final Map<String, String> agentIdBySessionId = new ConcurrentHashMap<>();
    private final Map<String, String> credentialIdBySessionId = new ConcurrentHashMap<>();

    public void connected(WebSocketSession session) {
        log.info("Edge agent WebSocket connected: {}", session.getId());
    }

    @Transactional
    public void disconnected(WebSocketSession session) {
        String agentId = agentIdBySessionId.remove(session.getId());
        credentialIdBySessionId.remove(session.getId());
        if (agentId == null) return;
        if (sessionsByAgentId.remove(agentId, session)) {
            markOffline(agentId);
        }
    }

    @Transactional
    public void handle(WebSocketSession session, String rawMessage) {
        try {
            JsonNode envelope = objectMapper.readTree(rawMessage);
            if (envelope.path("protocolVersion").asInt() != PROTOCOL_VERSION) {
                throw new IllegalArgumentException("Unsupported edge protocol version");
            }
            String type = envelope.path("type").asText();
            JsonNode payload = envelope.path("payload");
            if (!payload.isObject()) throw new IllegalArgumentException("Edge payload must be an object");
            Instant receivedAt = timeProvider.now();
            Instant sentAt = optionalInstant(envelope, "sentAt");
            switch (type) {
                case "agent_hello" -> hello(session, payload, receivedAt);
                case "agent_heartbeat" -> heartbeat(session, payload, sentAt, receivedAt);
                case "discovery_snapshot" -> discovery(session, payload, receivedAt);
                case "telemetry" -> telemetry(session, payload, receivedAt);
                case "command_result" -> commandResult(session, payload);
                default -> log.debug("Ignoring unsupported edge message type {}", type);
            }
        } catch (Exception exception) {
            log.warn("Ignoring invalid edge-agent message from {}: {}", session.getId(), exception.getMessage());
        }
    }

    @Scheduled(fixedDelayString = "${iot.edge-agent.dispatch-interval-ms:500}")
    public void dispatchPendingCommands() {
        scheduledDatabaseTaskGuard.run("edge-agent-command-dispatch",
                () -> commandRepository.findByStatusAndSource("PENDING", "EDGE_AGENT").forEach(this::dispatch));
    }

    @Scheduled(fixedDelayString = "${iot.edge-agent.timeout-interval-ms:1000}")
    public void markExpiredCommandsUnconfirmed() {
        scheduledDatabaseTaskGuard.run("edge-agent-command-timeout", () -> {
            Instant now = timeProvider.now();
            commandRepository.findByStatusAndSource("SENT", "EDGE_AGENT").stream()
                    .filter(command -> isExpired(command, now))
                    .forEach(command -> commandService.markUnconfirmed(
                            command.getCommandId(), "The edge agent did not return a confirmation before expiry"
                    ));
        });
    }

    private void dispatch(DeviceCommand pending) {
        DeviceConnection connection = connectionRepository.findByDeviceId(pending.getDevice().getId()).stream()
                .filter(candidate -> "EDGE_AGENT".equals(pending.getSource()))
                .filter(candidate -> candidate.getAgentId() != null && !candidate.getAgentId().isBlank())
                .filter(candidate -> "CONNECTED".equals(candidate.getStatus()))
                .findFirst()
                .orElse(null);
        if (connection == null) {
            commandService.completeFromEdgeAgent(
                    pending.getCommandId(), "FAILED", Map.of(), "EDGE_CONNECTION_UNAVAILABLE",
                    "No active edge connection is registered for this device", timeProvider.now()
            );
            return;
        }
        WebSocketSession session = sessionsByAgentId.get(connection.getAgentId());
        if (session == null || !session.isOpen()) {
            commandService.completeFromEdgeAgent(
                    pending.getCommandId(), "FAILED", Map.of(), "AGENT_OFFLINE",
                    "The edge agent is offline", timeProvider.now()
            );
            return;
        }
        if (securityProperties.isEnabled() && !isCredentialActive(session)) {
            commandService.completeFromEdgeAgent(
                    pending.getCommandId(), "FAILED", Map.of(), "AGENT_CREDENTIAL_REVOKED",
                    "The edge agent credential is no longer active", timeProvider.now()
            );
            return;
        }
        try {
            DeviceCommandViewGuard sent = new DeviceCommandViewGuard(commandService.markSentForEdgeAgent(pending.getCommandId()));
            if (!"SENT".equals(sent.status())) return;
            send(session, commandEnvelope(pending, connection));
        } catch (Exception exception) {
            commandService.completeFromEdgeAgent(
                    pending.getCommandId(), "FAILED", Map.of(), "DELIVERY_FAILED",
                    "Unable to deliver command to edge agent: " + exception.getMessage(), timeProvider.now()
            );
        }
    }

    @Transactional
    protected void hello(WebSocketSession session, JsonNode payload, Instant receivedAt) {
        JsonNode descriptor = payload.path("agent");
        String agentId = requiredText(descriptor, "agentId");
        String siteCode = requiredText(descriptor, "siteCode");
        LocalDateTime now = timeProvider.legacyServer(receivedAt);
        EdgeAgent agent;
        if (securityProperties.isEnabled()) {
            Object boundAgentId = session.getAttributes().get(EdgeAgentCredentialHandshakeInterceptor.AGENT_ID_ATTRIBUTE);
            Object boundSiteCode = session.getAttributes().get(EdgeAgentCredentialHandshakeInterceptor.SITE_CODE_ATTRIBUTE);
            Object boundDatabaseId = session.getAttributes().get(EdgeAgentCredentialHandshakeInterceptor.AGENT_DATABASE_ID_ATTRIBUTE);
            Object boundCredentialId = session.getAttributes().get(EdgeAgentCredentialHandshakeInterceptor.CREDENTIAL_ID_ATTRIBUTE);
            if (!(boundAgentId instanceof String expectedAgentId)
                    || !(boundSiteCode instanceof String expectedSiteCode)
                    || !(boundDatabaseId instanceof Long databaseId)
                    || !(boundCredentialId instanceof String credentialId)
                    || !agentId.equals(expectedAgentId)
                    || !siteCode.equals(expectedSiteCode)) {
                throw new IllegalArgumentException("Agent hello does not match the authenticated credential");
            }
            agent = agentRepository.findById(databaseId)
                    .orElseThrow(() -> new NoSuchElementException("Edge agent not found"));
            if (!agentId.equals(agent.getAgentId()) || !siteCode.equals(agent.getSite().getCode())) {
                throw new IllegalArgumentException("Agent identity is already assigned to a different site");
            }
            credentialIdBySessionId.put(session.getId(), credentialId);
        } else {
            Site site = resolveSite(siteCode);
            agent = agentRepository.findByAgentId(agentId).orElseGet(() -> EdgeAgent.builder()
                    .agentId(agentId)
                    .site(site)
                    .createdAt(now)
                    .build());
            if (!agent.getSite().getId().equals(site.getId())) {
                throw new IllegalArgumentException("Agent identity is already assigned to a different site");
            }
        }
        agent.setName(requiredText(descriptor, "agentName"));
        agent.setVersion(text(descriptor, "softwareVersion"));
        agent.setStatus("ONLINE");
        agent.setLastSeen(now);
        agent.setLastReceivedAt(receivedAt);
        agent.setMetadataJson(writeJson(payload.path("drivers")));
        agent.setUpdatedAt(now);
        agentRepository.save(agent);
        WebSocketSession previous = sessionsByAgentId.put(agentId, session);
        agentIdBySessionId.put(session.getId(), agentId);
        if (previous != null && previous != session && previous.isOpen()) {
            try { previous.close(); } catch (IOException ignored) { }
        }
        webSocketService.broadcastEvent("edge_agent_update", agentPayload(agent));
    }

    @Transactional
    protected void heartbeat(WebSocketSession session, JsonNode payload, Instant sentAt, Instant receivedAt) {
        EdgeAgent agent = agentFor(session);
        TimeObservation observation = observe(sentAt, receivedAt);
        agent.setStatus(text(payload, "status") == null ? "ONLINE" : text(payload, "status").toUpperCase());
        agent.setLastSeen(timeProvider.legacyServer(receivedAt));
        agent.setLastReceivedAt(receivedAt);
        agent.setReportedAt(sentAt);
        agent.setReportedTimeTrust(observation.trust());
        agent.setReportedClockSkewMs(observation.skewMillis());
        updateClockSkewState(agent, observation, receivedAt);
        agent.setUpdatedAt(timeProvider.legacyServer(receivedAt));
        agent.setMetadataJson(writeJson(nodeMap(payload.path("metrics"))));
        agentRepository.save(agent);
        platformMetricsService.edgeAgentClockTrust(observation.trust().name(), observation.skewMillis());
        webSocketService.broadcastEvent("edge_agent_update", agentPayload(agent));
    }

    @Transactional
    protected void discovery(WebSocketSession session, JsonNode payload, Instant receivedAt) {
        EdgeAgent agent = agentFor(session);
        String siteCode = requiredText(payload, "siteCode");
        if (!agent.getSite().getCode().equals(siteCode)) throw new IllegalArgumentException("Discovery site does not match agent site");
        for (JsonNode node : payload.path("devices")) {
            String externalId = requiredText(node, "deviceKey");
            String profileId = requiredText(node, "profileId");
            Instant observedAt = instant(node, "observedAt");
            DiscoveredDevice candidate = discoveredRepository.findByAgentIdAndExternalId(agent.getId(), externalId)
                    .orElseGet(() -> DiscoveredDevice.builder()
                            .candidateId(candidateId(agent.getAgentId(), externalId))
                            .agent(agent)
                            .externalId(externalId)
                            .firstSeen(timeProvider.legacyServer(receivedAt))
                            .lastSeen(timeProvider.legacyServer(receivedAt))
                            .firstReceivedAt(receivedAt)
                            .status("DISCOVERED")
                            .build());
            candidate.setProfileId(profileId);
            candidate.setProfileVersion(1);
            candidate.setDisplayName(requiredText(node, "displayName"));
            Map<String, Object> identity = nodeMap(node.path("identity"));
            candidate.setManufacturer(stringValue(identity.get("manufacturer")));
            candidate.setModel(stringValue(identity.get("model")));
            candidate.setEndpoint(requiredText(node, "endpoint"));
            candidate.setLastSeen(timeProvider.legacyServer(receivedAt));
            candidate.setLastReceivedAt(receivedAt);
            candidate.setReportedAt(observedAt);
            Map<String, Object> metadata = new LinkedHashMap<>();
            metadata.put("driverId", requiredText(node, "driverId"));
            metadata.put("endpoint", candidate.getEndpoint());
            metadata.put("identity", identity);
            metadata.put("reportedState", nodeMap(node.path("reportedState")));
            candidate.setMetadataJson(writeJson(metadata));
            discoveredRepository.save(candidate);
            updateClaimedConnection(agent, candidate, nodeMap(node.path("reportedState")), observedAt, receivedAt);
        }
        agent.setLastSeen(timeProvider.legacyServer(receivedAt));
        agent.setLastReceivedAt(receivedAt);
        agent.setUpdatedAt(timeProvider.legacyServer(receivedAt));
        agentRepository.save(agent);
    }

    @Transactional
    protected void telemetry(WebSocketSession session, JsonNode payload, Instant receivedAt) {
        EdgeAgent agent = agentFor(session);
        for (JsonNode sample : payload.path("samples")) {
            String externalId = requiredText(sample, "deviceKey");
            List<DeviceConnection> connections = connectionRepository.findByAgentIdAndExternalId(agent.getAgentId(), externalId);
            if (connections.isEmpty()) continue;
            Map<String, Object> values = nodeMap(sample.path("values"));
            Instant observedAt = instant(sample, "observedAt");
            for (DeviceConnection connection : connections) {
                Device device = connection.getDevice();
                device.setReportedStateJson(writeJson(values));
                device.setLastSeen(timeProvider.legacyServer(receivedAt));
                device.setLastReceivedAt(receivedAt);
                device.setStatus("ONLINE");
                connection.setLastSeen(timeProvider.legacyServer(receivedAt));
                connection.setLastReceivedAt(receivedAt);
                connection.setReportedAt(observedAt);
                connection.setStatus("CONNECTED");
                deviceRepository.save(device);
                connectionRepository.save(connection);
                telemetryService.record(device, values, "EDGE_AGENT", observedAt);
                webSocketService.sendDeviceUpdate(device);
            }
        }
    }

    protected void commandResult(WebSocketSession session, JsonNode payload) {
        EdgeAgent agent = agentFor(session);
        String commandId = requiredText(payload, "commandId");
        String deviceKey = requiredText(payload, "deviceKey");
        validateCommandResultOwnership(agent, commandId, deviceKey);
        commandService.completeFromEdgeAgent(
                commandId,
                requiredText(payload, "status"),
                nodeMap(payload.path("reportedState")),
                text(payload, "errorCode"),
                text(payload, "errorMessage"),
                instant(payload, "completedAt")
        );
    }

    private void validateCommandResultOwnership(EdgeAgent agent, String commandId, String deviceKey) {
        DeviceCommand command = commandRepository.findByCommandId(commandId)
                .orElseThrow(() -> new NoSuchElementException("Command not found"));
        if (!"EDGE_AGENT".equals(command.getSource())) {
            throw new IllegalArgumentException("Command is not routed through an edge agent");
        }
        boolean ownsConnection = connectionRepository.findByDeviceId(command.getDevice().getId()).stream()
                .anyMatch(connection -> "LAN_AGENT".equals(connection.getTransport())
                        && "CONNECTED".equals(connection.getStatus())
                        && agent.getAgentId().equals(connection.getAgentId())
                        && deviceKey.equals(connection.getExternalId()));
        if (!ownsConnection) {
            throw new IllegalArgumentException("Edge agent is not authorized to complete this device command");
        }
    }

    @Transactional
    protected void markOffline(String agentId) {
        agentRepository.findByAgentId(agentId).ifPresent(agent -> {
            agent.setStatus("OFFLINE");
            agent.setUpdatedAt(timeProvider.legacyServerNow());
            agentRepository.save(agent);
            webSocketService.broadcastEvent("edge_agent_update", agentPayload(agent));
        });
    }

    private void updateClaimedConnection(
            EdgeAgent agent, DiscoveredDevice candidate, Map<String, Object> state, Instant observedAt, Instant receivedAt
    ) {
        connectionRepository.findByAgentIdAndExternalId(agent.getAgentId(), candidate.getExternalId()).forEach(connection -> {
            connection.setStatus("CONNECTED");
            connection.setLastSeen(timeProvider.legacyServer(receivedAt));
            connection.setLastReceivedAt(receivedAt);
            connection.setReportedAt(observedAt);
            connection.setDriverId(stringValue(readJson(candidate.getMetadataJson()).get("driverId")));
            Device device = connection.getDevice();
            device.setReportedStateJson(writeJson(state));
            device.setLastSeen(timeProvider.legacyServer(receivedAt));
            device.setLastReceivedAt(receivedAt);
            device.setStatus("ONLINE");
            deviceRepository.save(device);
            connectionRepository.save(connection);
            telemetryService.record(device, state, "EDGE_AGENT", observedAt);
            webSocketService.sendDeviceUpdate(device);
        });
    }

    private EdgeAgent agentFor(WebSocketSession session) {
        String agentId = agentIdBySessionId.get(session.getId());
        if (agentId == null) throw new IllegalArgumentException("Agent hello is required before this message");
        if (securityProperties.isEnabled()) {
            Object boundAgentId = session.getAttributes().get(EdgeAgentCredentialHandshakeInterceptor.AGENT_ID_ATTRIBUTE);
            String credentialId = credentialIdBySessionId.get(session.getId());
            if (!(boundAgentId instanceof String expectedAgentId)
                    || !agentId.equals(expectedAgentId)
                    || credentialId == null
                    || !credentialService.isActive(credentialId)) {
                throw new IllegalArgumentException("Edge agent credential is no longer active");
            }
        }
        return agentRepository.findByAgentId(agentId).orElseThrow(() -> new NoSuchElementException("Edge agent not found"));
    }

    private boolean isCredentialActive(WebSocketSession session) {
        String credentialId = credentialIdBySessionId.get(session.getId());
        return credentialId != null && credentialService.isActive(credentialId);
    }

    private Site resolveSite(String siteCode) {
        bootstrapService.ensureDemoContext();
        Organization organization = organizationRepository.findByCode(DEMO_ORGANIZATION_CODE)
                .orElseThrow(() -> new NoSuchElementException("Organization not found"));
        return siteRepository.findByOrganizationAndCode(organization, siteCode)
                .orElseThrow(() -> new NoSuchElementException("Site not found"));
    }

    private Map<String, Object> commandEnvelope(DeviceCommand command, DeviceConnection connection) {
        Map<String, Object> metadata = readJson(connection.getMetadataJson());
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("commandId", command.getCommandId());
        payload.put("deviceKey", connection.getExternalId());
        payload.put("driverId", connection.getDriverId());
        payload.put("endpoint", metadata.get("endpoint"));
        payload.put("command", command.getType());
        payload.put("parameters", readJson(command.getParametersJson()));
        payload.put("expiresAt", command.getExpiresAtUtc() != null
                ? command.getExpiresAtUtc()
                : command.getExpiresAt() == null ? null : timeProvider.legacyServerInstant(command.getExpiresAt()));
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("type", "command_request");
        envelope.put("protocolVersion", PROTOCOL_VERSION);
        envelope.put("messageId", UUID.randomUUID());
        envelope.put("sentAt", timeProvider.now());
        envelope.put("payload", payload);
        return envelope;
    }

    private void send(WebSocketSession session, Map<String, Object> message) throws IOException {
        synchronized (session) {
            session.sendMessage(new TextMessage(writeJson(message)));
        }
    }

    private String candidateId(String agentId, String externalId) {
        return "candidate-" + UUID.nameUUIDFromBytes((agentId + "|" + externalId).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private Map<String, Object> agentPayload(EdgeAgent agent) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("agentId", agent.getAgentId());
        payload.put("siteId", agent.getSite().getId());
        payload.put("siteCode", agent.getSite().getCode());
        payload.put("name", agent.getName());
        payload.put("version", agent.getVersion());
        payload.put("status", agent.getStatus());
        payload.put("lastSeen", agent.getLastSeen());
        payload.put("lastReceivedAt", agent.getLastReceivedAt());
        payload.put("reportedAt", agent.getReportedAt());
        payload.put("reportedTimeTrust", agent.getReportedTimeTrust());
        payload.put("reportedClockSkewMs", agent.getReportedClockSkewMs());
        payload.put("clockSkewStreak", agent.getClockSkewStreak());
        return payload;
    }

    /**
     * Clock skew is a diagnostic condition only.  It must never change the
     * connection state because the service receipt time is the availability
     * authority.  Persisting the streak makes the three-heartbeat threshold
     * deterministic across reconnects and process restarts.
     */
    private void updateClockSkewState(EdgeAgent agent, TimeObservation observation, Instant receivedAt) {
        if (observation.trust() != ObservedTimeTrust.SKEWED) {
            agent.setClockSkewStreak(0);
            // Missing sender time is not evidence that the remote clock recovered.
            if (observation.trust() == ObservedTimeTrust.TRUSTED) {
                String alertCode = clockSkewAlertCode(agent);
                List<Alert> openAlerts = alertRepository.findBySite_IdAndResolvedFalseAndAlertCode(
                        agent.getSite().getId(), alertCode);
                for (Alert alert : openAlerts) {
                    alert.setResolved(true);
                    alert.setStatus("RESOLVED");
                    alert.setResolvedAt(timeProvider.legacyServer(receivedAt));
                    alert.setResolvedAtUtc(receivedAt);
                    webSocketService.sendAlertUpdate(alertRepository.save(alert));
                }
                agent.setClockSkewAlerted(false);
            }
            return;
        }

        int streak = Math.min(3, Math.max(0, agent.getClockSkewStreak() == null ? 0 : agent.getClockSkewStreak()) + 1);
        agent.setClockSkewStreak(streak);
        if (streak < 3) return;

        String alertCode = clockSkewAlertCode(agent);
        if (!alertRepository.existsBySite_IdAndResolvedFalseAndAlertCode(agent.getSite().getId(), alertCode)) {
            Alert alert = alertRepository.save(Alert.builder()
                    .site(agent.getSite())
                    .level("WARNING")
                    .status("OPEN")
                    .alertCode(alertCode)
                    .message("Edge agent " + agent.getAgentId()
                            + " reported clock skew outside the allowed tolerance for three consecutive heartbeats")
                    .createdAt(timeProvider.legacyServer(receivedAt))
                    .createdAtUtc(receivedAt)
                    .build());
            webSocketService.sendAlert(alert);
        }
        agent.setClockSkewAlerted(true);
    }

    private String clockSkewAlertCode(EdgeAgent agent) {
        return "EDGE_AGENT_CLOCK_SKEW:" + agent.getAgentId();
    }

    private String requiredText(JsonNode node, String field) {
        String value = text(node, field);
        if (value == null) throw new IllegalArgumentException("Edge payload field " + field + " is required");
        return value;
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText() : null;
    }

    private Instant instant(JsonNode node, String field) {
        try {
            return Instant.parse(requiredText(node, field));
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("Edge payload field " + field + " must be an ISO-8601 instant");
        }
    }

    private Instant optionalInstant(JsonNode node, String field) {
        String value = text(node, field);
        if (value == null) return null;
        try {
            return Instant.parse(value);
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("Edge payload field " + field + " must be an ISO-8601 instant");
        }
    }

    private TimeObservation observe(Instant observedAt, Instant receivedAt) {
        if (observedAt == null) return new TimeObservation(ObservedTimeTrust.UNKNOWN, null);
        Duration skew;
        try {
            skew = Duration.between(observedAt, receivedAt);
        } catch (ArithmeticException exception) {
            return new TimeObservation(ObservedTimeTrust.SKEWED, null);
        }
        ObservedTimeTrust trust;
        try {
            trust = skew.abs().compareTo(timeProperties.getClockSkewTolerance()) <= 0
                    ? ObservedTimeTrust.TRUSTED : ObservedTimeTrust.SKEWED;
        } catch (ArithmeticException exception) {
            trust = ObservedTimeTrust.SKEWED;
        }
        Long skewMillis;
        try {
            skewMillis = skew.toMillis();
        } catch (ArithmeticException exception) {
            skewMillis = null;
        }
        return new TimeObservation(trust, skewMillis);
    }

    private boolean isExpired(DeviceCommand command, Instant now) {
        if (command.getExpiresAtUtc() != null) return !command.getExpiresAtUtc().isAfter(now);
        return command.getExpiresAt() != null
                && !command.getExpiresAt().isAfter(timeProvider.legacyServer(now));
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Unable to serialize edge-agent payload");
        }
    }

    private Map<String, Object> readJson(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return objectMapper.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() { });
        } catch (JsonProcessingException exception) {
            return Map.of();
        }
    }

    private Map<String, Object> nodeMap(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) return Map.of();
        return objectMapper.convertValue(node, new TypeReference<LinkedHashMap<String, Object>>() { });
    }

    private String stringValue(Object value) {
        return value instanceof String string && !string.isBlank() ? string : null;
    }

    private record DeviceCommandViewGuard(com.iot.manager.dto.DeviceCommandView command) {
        private String status() { return command.status(); }
    }

    private record TimeObservation(ObservedTimeTrust trust, Long skewMillis) {
    }
}
