package com.iot.manager.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.DeviceCommandRequest;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.dto.RealtimeEvent;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceCommand;
import com.iot.manager.repository.DeviceCommandRepository;
import com.iot.manager.repository.DeviceConnectionRepository;
import com.iot.manager.repository.DeviceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class CommandService {

    private static final String PENDING = "PENDING";
    private static final String SENT = "SENT";
    private static final String ACKNOWLEDGED = "ACKNOWLEDGED";
    private static final String FAILED = "FAILED";
    private static final String UNCONFIRMED = "UNCONFIRMED";
    private static final String REJECTED = "REJECTED";
    private static final String LAN_MOCK = "LAN_MOCK";
    private static final String EDGE_AGENT = "EDGE_AGENT";
    private static final String API = "API";
    private static final int MAX_JSON_LENGTH = 4000;
    private static final int MAX_ERROR_MESSAGE_LENGTH = 2000;
    private static final int MAX_ACTIVITY_RESULT_LENGTH = 1000;
    private static final int MAX_ACTIVITY_ERROR_LENGTH = 1000;
    private static final String LATE_VALIDATION_FAILURE_REASON =
            "Command result or reported state exceeds storage limits";

    private final DeviceRepository deviceRepository;
    private final DeviceCommandRepository commandRepository;
    private final DeviceConnectionRepository connectionRepository;
    private final AuditEventService auditEventService;
    private final AuditContextService auditContextService;
    private final ObjectMapper objectMapper;
    private final WebSocketService webSocketService;
    private final PlatformTransactionManager transactionManager;
    private final DeviceProfileService profileService;
    private final CommandBatchSummaryService batchSummaryService;
    private final PlatformMetricsService platformMetricsService;

    @Transactional
    public DeviceCommandView submit(Long deviceId, DeviceCommandRequest request) {
        validateRequestEnvelope(request);
        String parametersJson = writeBoundedJson(request.parameters(), "parameters");
        Device device = deviceRepository.findByIdForUpdate(deviceId)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
        ProfileCommandSpec spec = profileService.validateCommand(device, request);

        return commandRepository.findByDeviceIdAndIdempotencyKey(device.getId(), request.idempotencyKey().trim())
                .map(existing -> toView(existing, device))
                .orElseGet(() -> {
                    preflightAcknowledgement(device, spec);
                    return createPending(device, request, spec, parametersJson,
                            SubmissionMetadata.api(auditContextService.currentSubjectOrAnonymous()));
                });
    }

    @Transactional(noRollbackFor = CommandValidationException.class)
    public DeviceCommandView submitBatchTarget(
            Long deviceId,
            String type,
            Map<String, Object> parameters,
            String batchId,
            String idempotencyKey,
            String requestFingerprint,
            LocalDateTime expiresAt
    ) {
        Device device = deviceRepository.findByIdForUpdate(deviceId)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
        DeviceCommandRequest request = new DeviceCommandRequest(type, idempotencyKey, parameters);
        validateRequestEnvelope(request);
        ProfileCommandSpec spec = profileService.validateCommand(device, request);
        String parametersJson = writeBoundedJson(parameters, "parameters");
        preflightAcknowledgement(device, spec);
        return createPending(device, request, spec, parametersJson,
                new SubmissionMetadata(
                        batchId,
                        requestFingerprint,
                        "BATCH",
                        auditContextService.currentSubjectOrAnonymous(),
                        expiresAt
                ));
    }

    @Transactional
    public DeviceCommandView rejectBatchTarget(
            Long deviceId,
            String type,
            Map<String, Object> parameters,
            String batchId,
            String idempotencyKey,
            String requestFingerprint,
            String reason
    ) {
        Device device = deviceRepository.findByIdForUpdate(deviceId)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
        long nextSequence = (device.getCommandSequence() == null ? 0L : device.getCommandSequence()) + 1;
        device.setCommandSequence(nextSequence);
        String boundedReason = truncate(reason, MAX_ERROR_MESSAGE_LENGTH);
        DeviceCommand command = commandRepository.save(DeviceCommand.builder()
                .commandId("command-" + UUID.randomUUID())
                .device(device)
                .type(type == null ? "unknown" : type.trim().toLowerCase(Locale.ROOT))
                .source("PROFILE")
                .parametersJson(writeBoundedJson(parameters, "parameters"))
                .idempotencyKey(idempotencyKey)
                .status(REJECTED)
                .batchId(batchId)
                .sequenceNo(nextSequence)
                .requestFingerprint(requestFingerprint)
                .requestOrigin("BATCH")
                .requestedBy(auditContextService.currentSubjectOrAnonymous())
                .failureCode("PROFILE_UNSUPPORTED")
                .errorMessage(boundedReason)
                .resultJson(writeBoundedJson(Map.of("applied", false, "reason", boundedReason), "result"))
                .requestedAt(LocalDateTime.now())
                .completedAt(LocalDateTime.now())
                .dispatchAttempts(0)
                .build());
        publishTransition(command, device, null, "command_rejected", "Command rejected by device profile");
        return toView(command, device);
    }

    @Transactional(readOnly = true)
    public DeviceCommandView getByCommandId(String commandId) {
        return commandRepository.findByCommandId(commandId)
                .map(command -> toView(command, command.getDevice()))
                .orElseThrow(() -> new NoSuchElementException("Command not found"));
    }

    @Transactional(readOnly = true)
    public DeviceCommandView view(DeviceCommand command) {
        return toView(command, command.getDevice());
    }

    public DeviceCommandView processPending(String commandId) {
        DeviceCommandView processed = processPendingInNewTransaction(commandId);
        return processed == null ? getByCommandId(commandId) : processed;
    }

    public List<DeviceCommandView> processPending() {
        return commandRepository.findPendingCommandIdsOrderByRequestedAtAscIdAsc().stream()
                .map(this::processPendingInNewTransaction)
                .filter(Objects::nonNull)
                .toList();
    }

    private DeviceCommandView processPendingInNewTransaction(String commandId) {
        return requiresNewTransaction().execute(status -> processPendingLocked(commandId));
    }

    private DeviceCommandView processPendingLocked(String commandId) {
        Long deviceId = commandRepository.findDeviceIdByCommandId(commandId)
                .orElseThrow(() -> new NoSuchElementException("Command not found"));
        Device device = deviceRepository.findByIdForUpdate(deviceId)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
        DeviceCommand command = commandRepository.findByCommandIdForUpdate(commandId)
                .orElseThrow(() -> new NoSuchElementException("Command not found"));

        if (!PENDING.equals(command.getStatus())) {
            return toView(command, device);
        }

        transition(command, device, SENT, "command_sent", "Command sent");

        if ("simulate_failure".equals(command.getType())) {
            return failCommand(command, device, "Simulated device failure");
        }

        try {
            ProfileCommandSpec spec = validateStoredCommand(command, device);
            String reportedStateJson = writeBoundedJson(prospectiveReportedState(device, spec), "reportedState");
            String resultJson = writeBoundedJson(successResult(spec), "result");

            device.setReportedStateJson(reportedStateJson);
            String previousStatus = command.getStatus();
            command.setStatus(ACKNOWLEDGED);
            command.setAcknowledgedAt(LocalDateTime.now());
            command.setResultJson(resultJson);
            complete(command);
            publishTransition(command, device, previousStatus, "command_acknowledged", "Command acknowledged");
            return toView(command, device);
        } catch (CommandValidationException exception) {
            return failCommand(command, device, LATE_VALIDATION_FAILURE_REASON);
        }
    }

    private TransactionTemplate requiresNewTransaction() {
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        template.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return template;
    }

    private DeviceCommandView createPending(
            Device device,
            DeviceCommandRequest request,
            ProfileCommandSpec spec,
            String parametersJson,
            SubmissionMetadata metadata
    ) {
        Map<String, Object> desiredState = readJson(device.getDesiredStateJson());
        if (spec.stateField() != null) {
            desiredState.put(spec.stateField(), spec.stateValue());
            device.setDesiredStateJson(writeBoundedJson(desiredState, "desiredState"));
        }

        long nextSequence = (device.getCommandSequence() == null ? 0L : device.getCommandSequence()) + 1;
        device.setCommandSequence(nextSequence);
        DeviceCommand command = commandRepository.save(DeviceCommand.builder()
                .commandId("command-" + UUID.randomUUID())
                .device(device)
                .type(spec.type())
                .source(sourceFor(device))
                .parametersJson(parametersJson)
                .idempotencyKey(request.idempotencyKey().trim())
                .status(PENDING)
                .batchId(metadata.batchId())
                .sequenceNo(nextSequence)
                .requestFingerprint(metadata.requestFingerprint())
                .requestOrigin(metadata.requestOrigin())
                .requestedBy(metadata.requestedBy())
                .expiresAt(metadata.expiresAt())
                .dispatchAttempts(0)
                .requestedAt(LocalDateTime.now())
                .build());
        publishTransition(command, device, null, "command_submitted", "Command submitted");
        return toView(command, device);
    }

    private void preflightAcknowledgement(Device device, ProfileCommandSpec spec) {
        if (spec.stateField() == null) {
            return;
        }
        writeBoundedJson(prospectiveReportedState(device, spec), "reportedState");
        writeBoundedJson(successResult(spec), "result");
    }

    private Map<String, Object> prospectiveReportedState(Device device, ProfileCommandSpec spec) {
        Map<String, Object> reportedState = readJson(device.getReportedStateJson());
        if (spec.stateField() != null) {
            reportedState.put(spec.stateField(), spec.stateValue());
        }
        return reportedState;
    }

    private Map<String, Object> successResult(ProfileCommandSpec spec) {
        return Map.of(
                "applied", true,
                "stateField", spec.stateField(),
                "stateValue", spec.stateValue()
        );
    }

    private DeviceCommandView failCommand(DeviceCommand command, Device device, String reason) {
        String boundedReason = truncate(reason, MAX_ERROR_MESSAGE_LENGTH);
        String previousStatus = command.getStatus();
        command.setStatus(FAILED);
        command.setErrorMessage(boundedReason);
        command.setResultJson(writeBoundedJson(Map.of(
                "applied", false,
                "reason", boundedReason
        ), "result"));
        command.setFailureCode("COMMAND_FAILED");
        complete(command);
        publishTransition(command, device, previousStatus, "command_failed", "Command failed");
        return toView(command, device);
    }

    public DeviceCommandView markUnconfirmed(String commandId, String reason) {
        return requiresNewTransaction().execute(status -> {
            DeviceCommand command = commandRepository.findByCommandIdForUpdate(commandId)
                    .orElseThrow(() -> new NoSuchElementException("Command not found"));
            Device device = deviceRepository.findByIdForUpdate(command.getDevice().getId())
                    .orElseThrow(() -> new NoSuchElementException("Device not found"));
            if (!PENDING.equals(command.getStatus()) && !SENT.equals(command.getStatus())) return toView(command, device);
            String previousStatus = command.getStatus();
            command.setStatus(UNCONFIRMED);
            command.setErrorMessage(truncate(reason, MAX_ERROR_MESSAGE_LENGTH));
            command.setFailureCode("CONFIRMATION_TIMEOUT");
            command.setResultJson(writeBoundedJson(Map.of("applied", false, "reason", command.getErrorMessage()), "result"));
            complete(command);
            publishTransition(command, device, previousStatus, "command_unconfirmed", "Command confirmation timed out");
            return toView(command, device);
        });
    }

    public DeviceCommandView markSentForEdgeAgent(String commandId) {
        return requiresNewTransaction().execute(status -> {
            DeviceCommand command = commandRepository.findByCommandIdForUpdate(commandId)
                    .orElseThrow(() -> new NoSuchElementException("Command not found"));
            Device device = deviceRepository.findByIdForUpdate(command.getDevice().getId())
                    .orElseThrow(() -> new NoSuchElementException("Device not found"));
            if (!PENDING.equals(command.getStatus())) return toView(command, device);
            transition(command, device, SENT, "command_sent", "Command sent to edge agent");
            return toView(command, device);
        });
    }

    public DeviceCommandView completeFromEdgeAgent(
            String commandId,
            String status,
            Map<String, Object> reportedState,
            String errorCode,
            String errorMessage,
            Instant completedAt
    ) {
        return requiresNewTransaction().execute(transactionStatus -> {
            DeviceCommand command = commandRepository.findByCommandIdForUpdate(commandId)
                    .orElseThrow(() -> new NoSuchElementException("Command not found"));
            Device device = deviceRepository.findByIdForUpdate(command.getDevice().getId())
                    .orElseThrow(() -> new NoSuchElementException("Device not found"));
            if (isTerminal(command.getStatus())) {
                publishTransition(command, device, command.getStatus(), "command_late_ack", "Late edge-agent result retained for audit");
                return toView(command, device);
            }
            String normalized = status == null ? FAILED : status.trim().toUpperCase(Locale.ROOT);
            LocalDateTime completed = completedAt == null
                    ? LocalDateTime.now()
                    : LocalDateTime.ofInstant(completedAt, java.time.ZoneOffset.UTC);
            return switch (normalized) {
                case ACKNOWLEDGED -> acknowledgeFromEdge(command, device, reportedState, completed);
                case UNCONFIRMED -> unconfirmFromEdge(command, device, errorCode, errorMessage, completed);
                case REJECTED -> rejectFromEdge(command, device, errorCode, errorMessage, completed);
                default -> failFromEdge(command, device, errorCode, errorMessage, completed);
            };
        });
    }

    private DeviceCommandView acknowledgeFromEdge(
            DeviceCommand command, Device device, Map<String, Object> reportedState, LocalDateTime completed
    ) {
        Map<String, Object> state = reportedState == null ? Map.of() : reportedState;
        String previousStatus = command.getStatus();
        device.setReportedStateJson(writeBoundedJson(state, "reportedState"));
        command.setStatus(ACKNOWLEDGED);
        command.setAcknowledgedAt(completed);
        command.setCompletedAt(completed);
        command.setFailureCode(null);
        command.setErrorMessage(null);
        command.setResultJson(writeBoundedJson(Map.of("applied", true, "reportedState", state), "result"));
        publishTransition(command, device, previousStatus, "command_acknowledged", "Edge agent confirmed device state");
        return toView(command, device);
    }

    private DeviceCommandView unconfirmFromEdge(
            DeviceCommand command, Device device, String errorCode, String errorMessage, LocalDateTime completed
    ) {
        String previousStatus = command.getStatus();
        String reason = truncate(orDefault(errorMessage, "Device state could not be confirmed"), MAX_ERROR_MESSAGE_LENGTH);
        command.setStatus(UNCONFIRMED);
        command.setFailureCode(orDefault(errorCode, "CONFIRMATION_TIMEOUT"));
        command.setErrorMessage(reason);
        command.setCompletedAt(completed);
        command.setResultJson(writeBoundedJson(Map.of("applied", false, "reason", reason), "result"));
        publishTransition(command, device, previousStatus, "command_unconfirmed", "Edge agent could not confirm device state");
        return toView(command, device);
    }

    private DeviceCommandView rejectFromEdge(
            DeviceCommand command, Device device, String errorCode, String errorMessage, LocalDateTime completed
    ) {
        String previousStatus = command.getStatus();
        String reason = truncate(orDefault(errorMessage, "Device rejected command"), MAX_ERROR_MESSAGE_LENGTH);
        command.setStatus(REJECTED);
        command.setFailureCode(orDefault(errorCode, "DEVICE_REJECTED"));
        command.setErrorMessage(reason);
        command.setCompletedAt(completed);
        command.setResultJson(writeBoundedJson(Map.of("applied", false, "reason", reason), "result"));
        publishTransition(command, device, previousStatus, "command_rejected", "Edge agent reported device rejection");
        return toView(command, device);
    }

    private DeviceCommandView failFromEdge(
            DeviceCommand command, Device device, String errorCode, String errorMessage, LocalDateTime completed
    ) {
        String previousStatus = command.getStatus();
        String reason = truncate(orDefault(errorMessage, "Edge agent delivery failed"), MAX_ERROR_MESSAGE_LENGTH);
        command.setStatus(FAILED);
        command.setFailureCode(orDefault(errorCode, "EDGE_AGENT_FAILED"));
        command.setErrorMessage(reason);
        command.setCompletedAt(completed);
        command.setResultJson(writeBoundedJson(Map.of("applied", false, "reason", reason), "result"));
        publishTransition(command, device, previousStatus, "command_failed", "Edge agent command failed");
        return toView(command, device);
    }

    private void transition(DeviceCommand command, Device device, String nextStatus, String activityType, String detail) {
        String previousStatus = command.getStatus();
        command.setStatus(nextStatus);
        if (SENT.equals(nextStatus)) command.setSentAt(LocalDateTime.now());
        if (ACKNOWLEDGED.equals(nextStatus) || FAILED.equals(nextStatus) || UNCONFIRMED.equals(nextStatus) || REJECTED.equals(nextStatus)) {
            complete(command);
        }
        publishTransition(command, device, previousStatus, activityType, detail);
    }

    private void complete(DeviceCommand command) {
        if (command.getCompletedAt() == null) command.setCompletedAt(LocalDateTime.now());
    }

    private boolean isTerminal(String status) {
        return ACKNOWLEDGED.equals(status) || FAILED.equals(status) || UNCONFIRMED.equals(status) || REJECTED.equals(status);
    }

    private String orDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private void publishTransition(
            DeviceCommand command,
            Device device,
            String previousStatus,
            String activityType,
            String detail
    ) {
        ActivityEvent activity = auditEventService.recordCommandTransition(
                command,
                device,
                previousStatus,
                activityType,
                detail,
                compactActivityPayload(command, device)
        );
        platformMetricsService.commandTransition(command.getStatus());
        DeviceCommandView view = toView(command, device);
        webSocketService.broadcastEvent(new RealtimeEvent("command_update", view));
        webSocketService.sendActivityUpdate(activity);
        batchSummaryService.refresh(command.getBatchId());
    }

    private Map<String, Object> activityPayload(DeviceCommand command, Device device) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("commandId", command.getCommandId());
        payload.put("deviceId", device.getId());
        payload.put("type", command.getType());
        payload.put("source", command.getSource());
        payload.put("status", command.getStatus());
        Map<String, Object> result = readJson(command.getResultJson());
        payload.put("result", writeJson(result).length() <= MAX_ACTIVITY_RESULT_LENGTH
                ? result
                : Map.of("truncated", true));
        payload.put("error", truncate(command.getErrorMessage(), MAX_ACTIVITY_ERROR_LENGTH));
        payload.put("requestedAt", command.getRequestedAt());
        payload.put("acknowledgedAt", command.getAcknowledgedAt());
        return payload;
    }

    private String compactActivityPayload(DeviceCommand command, Device device) {
        return writeJson(activityPayload(command, device));
    }

    private DeviceCommandView toView(DeviceCommand command, Device device) {
        return new DeviceCommandView(
                command.getCommandId(),
                device.getId(),
                command.getType(),
                command.getSource(),
                command.getStatus(),
                readJson(command.getParametersJson()),
                readJson(device.getDesiredStateJson()),
                readJson(device.getReportedStateJson()),
                readJson(command.getResultJson()),
                command.getErrorMessage(),
                command.getRequestedAt(),
                command.getAcknowledgedAt(),
                command.getBatchId(),
                command.getSequenceNo(),
                command.getRequestOrigin(),
                command.getFailureCode(),
                command.getSentAt(),
                command.getCompletedAt()
        );
    }

    private String sourceFor(Device device) {
        return connectionRepository.findByDeviceId(device.getId()).stream()
                .anyMatch(connection -> "LAN_AGENT".equals(connection.getTransport())
                        && "CONNECTED".equals(connection.getStatus())
                        && connection.getAgentId() != null && !connection.getAgentId().isBlank())
                ? EDGE_AGENT
                : connectionRepository.findByDeviceId(device.getId()).stream()
                        .anyMatch(connection -> "LAN_AGENT".equals(connection.getTransport())
                                && "CONNECTED".equals(connection.getStatus()))
                ? LAN_MOCK
                : API;
    }

    private ProfileCommandSpec validateStoredCommand(DeviceCommand command, Device device) {
        return profileService.validateCommand(device, new DeviceCommandRequest(
                command.getType(),
                command.getIdempotencyKey(),
                readJson(command.getParametersJson())
        ));
    }

    private void validateRequestEnvelope(DeviceCommandRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        if (request == null) {
            errors.put("request", "must not be null");
            throw new CommandValidationException(errors);
        }
        String type = request.type() == null ? null : request.type().trim().toLowerCase(Locale.ROOT);
        if (type == null || type.isBlank()) {
            errors.put("type", "must not be blank");
        }
        if (request.idempotencyKey() == null || request.idempotencyKey().isBlank()) {
            errors.put("idempotencyKey", "must not be blank");
        }
        if (!errors.isEmpty()) {
            throw new CommandValidationException(errors);
        }
    }

    private Map<String, Object> readJson(String json) {
        if (json == null || json.isBlank()) {
            return new LinkedHashMap<>();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() {
            });
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Unable to read command JSON", exception);
        }
    }

    private String writeJson(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Unable to write command JSON", exception);
        }
    }

    private String writeBoundedJson(Map<String, Object> value, String field) {
        String json;
        try {
            json = writeJson(value);
        } catch (IllegalStateException exception) {
            throw new CommandValidationException(Map.of(field, "must contain valid JSON values"));
        }
        if (json.length() > MAX_JSON_LENGTH) {
            throw new CommandValidationException(Map.of(
                    field,
                    "must serialize to at most " + MAX_JSON_LENGTH + " characters"
            ));
        }
        return json;
    }

    private String truncate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength);
    }

    private record SubmissionMetadata(
            String batchId,
            String requestFingerprint,
            String requestOrigin,
            String requestedBy,
            LocalDateTime expiresAt
    ) {
        private static SubmissionMetadata api(String requestedBy) {
            return new SubmissionMetadata(null, null, "API", requestedBy, LocalDateTime.now().plusMinutes(5));
        }
    }

}
