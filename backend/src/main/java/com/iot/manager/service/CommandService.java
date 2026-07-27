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
import com.iot.manager.repository.ActivityEventRepository;
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
    private static final String LAN_MOCK = "LAN_MOCK";
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
    private final ActivityEventRepository activityEventRepository;
    private final ObjectMapper objectMapper;
    private final WebSocketService webSocketService;
    private final PlatformTransactionManager transactionManager;

    @Transactional
    public DeviceCommandView submit(Long deviceId, DeviceCommandRequest request) {
        CommandSpec spec = validate(request);
        String parametersJson = writeBoundedJson(request.parameters(), "parameters");
        Device device = deviceRepository.findByIdForUpdate(deviceId)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));

        return commandRepository.findByDeviceIdAndIdempotencyKey(device.getId(), request.idempotencyKey().trim())
                .map(existing -> toView(existing, device))
                .orElseGet(() -> {
                    preflightAcknowledgement(device, spec);
                    return createPending(device, request, spec, parametersJson);
                });
    }

    @Transactional(readOnly = true)
    public DeviceCommandView getByCommandId(String commandId) {
        return commandRepository.findByCommandId(commandId)
                .map(command -> toView(command, command.getDevice()))
                .orElseThrow(() -> new NoSuchElementException("Command not found"));
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

        command.setStatus(SENT);
        publishTransition(command, device, "command_sent", "Command sent");

        if ("simulate_failure".equals(command.getType())) {
            return failCommand(command, device, "Simulated device failure");
        }

        try {
            CommandSpec spec = validateStoredCommand(command);
            String reportedStateJson = writeBoundedJson(prospectiveReportedState(device, spec), "reportedState");
            String resultJson = writeBoundedJson(successResult(spec), "result");

            device.setReportedStateJson(reportedStateJson);
            command.setStatus(ACKNOWLEDGED);
            command.setAcknowledgedAt(LocalDateTime.now());
            command.setResultJson(resultJson);
            publishTransition(command, device, "command_acknowledged", "Command acknowledged");
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
            CommandSpec spec,
            String parametersJson
    ) {
        Map<String, Object> desiredState = readJson(device.getDesiredStateJson());
        if (spec.stateField() != null) {
            desiredState.put(spec.stateField(), spec.stateValue());
            device.setDesiredStateJson(writeBoundedJson(desiredState, "desiredState"));
        }

        DeviceCommand command = commandRepository.save(DeviceCommand.builder()
                .commandId("command-" + UUID.randomUUID())
                .device(device)
                .type(spec.type())
                .source(sourceFor(device))
                .parametersJson(parametersJson)
                .idempotencyKey(request.idempotencyKey().trim())
                .status(PENDING)
                .requestedAt(LocalDateTime.now())
                .build());
        publishTransition(command, device, "command_submitted", "Command submitted");
        return toView(command, device);
    }

    private void preflightAcknowledgement(Device device, CommandSpec spec) {
        if (spec.stateField() == null) {
            return;
        }
        writeBoundedJson(prospectiveReportedState(device, spec), "reportedState");
        writeBoundedJson(successResult(spec), "result");
    }

    private Map<String, Object> prospectiveReportedState(Device device, CommandSpec spec) {
        Map<String, Object> reportedState = readJson(device.getReportedStateJson());
        if (spec.stateField() != null) {
            reportedState.put(spec.stateField(), spec.stateValue());
        }
        return reportedState;
    }

    private Map<String, Object> successResult(CommandSpec spec) {
        return Map.of(
                "applied", true,
                "stateField", spec.stateField(),
                "stateValue", spec.stateValue()
        );
    }

    private DeviceCommandView failCommand(DeviceCommand command, Device device, String reason) {
        String boundedReason = truncate(reason, MAX_ERROR_MESSAGE_LENGTH);
        command.setStatus(FAILED);
        command.setErrorMessage(boundedReason);
        command.setResultJson(writeBoundedJson(Map.of(
                "applied", false,
                "reason", boundedReason
        ), "result"));
        publishTransition(command, device, "command_failed", "Command failed");
        return toView(command, device);
    }

    private void publishTransition(DeviceCommand command, Device device, String activityType, String detail) {
        ActivityEvent activity = activityEventRepository.save(ActivityEvent.builder()
                .device(device)
                .eventType(activityType)
                .detail(detail)
                .payloadJson(compactActivityPayload(command, device))
                .occurredAt(LocalDateTime.now())
                .build());
        DeviceCommandView view = toView(command, device);
        webSocketService.broadcastEvent(new RealtimeEvent("command_update", view));
        webSocketService.sendActivityUpdate(activity);
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
                command.getAcknowledgedAt()
        );
    }

    private String sourceFor(Device device) {
        return connectionRepository.findByDeviceId(device.getId()).stream()
                .anyMatch(connection -> "LAN_AGENT".equals(connection.getTransport())
                        && "CONNECTED".equals(connection.getStatus()))
                ? LAN_MOCK
                : API;
    }

    private CommandSpec validateStoredCommand(DeviceCommand command) {
        return validate(new DeviceCommandRequest(
                command.getType(),
                command.getIdempotencyKey(),
                readJson(command.getParametersJson())
        ));
    }

    private CommandSpec validate(DeviceCommandRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        if (request == null) {
            throw new CommandValidationException(Map.of("request", "must not be null"));
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

        Map<String, Object> parameters = request.parameters();
        return switch (type) {
            case "set_power" -> new CommandSpec(type, "power", requiredBoolean(parameters, "on"));
            case "set_level" -> new CommandSpec(type, "level", requiredNumber(parameters, "level"));
            case "set_mode" -> new CommandSpec(type, "mode", requiredText(parameters, "mode"));
            case "simulate_failure" -> new CommandSpec(type, null, null);
            default -> throw new CommandValidationException(Map.of("type", "must be one of set_power, set_level, set_mode, simulate_failure"));
        };
    }

    private Boolean requiredBoolean(Map<String, Object> parameters, String field) {
        Object value = parameters.get(field);
        if (value instanceof Boolean booleanValue) {
            return booleanValue;
        }
        throw new CommandValidationException(Map.of("parameters." + field, "must be a boolean"));
    }

    private Number requiredNumber(Map<String, Object> parameters, String field) {
        Object value = parameters.get(field);
        if (value instanceof Number number) {
            return number;
        }
        throw new CommandValidationException(Map.of("parameters." + field, "must be a number"));
    }

    private String requiredText(Map<String, Object> parameters, String field) {
        Object value = parameters.get(field);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        throw new CommandValidationException(Map.of("parameters." + field, "must be a nonblank string"));
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

    private record CommandSpec(String type, String stateField, Object stateValue) {
    }
}
