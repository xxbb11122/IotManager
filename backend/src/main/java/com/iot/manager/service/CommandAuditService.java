package com.iot.manager.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.CommandEventView;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.dto.PageResponse;
import com.iot.manager.entity.CommandEvent;
import com.iot.manager.entity.DeviceCommand;
import com.iot.manager.repository.CommandEventRepository;
import com.iot.manager.repository.DeviceCommandRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class CommandAuditService {

    private final DeviceCommandRepository commandRepository;
    private final CommandEventRepository eventRepository;
    private final CommandService commandService;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public PageResponse<DeviceCommandView> search(
            Long deviceId, String batchId, String status, String type, String deliveryRoute,
            String requestOrigin, LocalDateTime from, LocalDateTime to, int page, int size
    ) {
        Specification<DeviceCommand> specification = Specification.where(null);
        if (deviceId != null) specification = specification.and((root, query, builder) -> builder.equal(root.get("device").get("id"), deviceId));
        if (hasText(batchId)) specification = specification.and((root, query, builder) -> builder.equal(root.get("batchId"), batchId.trim()));
        if (hasText(status)) specification = specification.and((root, query, builder) -> builder.equal(root.get("status"), status.trim().toUpperCase()));
        if (hasText(type)) specification = specification.and((root, query, builder) -> builder.equal(root.get("type"), type.trim().toLowerCase()));
        if (hasText(deliveryRoute)) specification = specification.and((root, query, builder) -> builder.equal(root.get("source"), deliveryRoute.trim().toUpperCase()));
        if (hasText(requestOrigin)) specification = specification.and((root, query, builder) -> builder.equal(root.get("requestOrigin"), requestOrigin.trim().toUpperCase()));
        if (from != null) specification = specification.and((root, query, builder) -> builder.greaterThanOrEqualTo(root.get("requestedAt"), from));
        if (to != null) specification = specification.and((root, query, builder) -> builder.lessThanOrEqualTo(root.get("requestedAt"), to));
        int normalizedPage = Math.max(0, page);
        int normalizedSize = Math.min(100, Math.max(1, size));
        return PageResponse.from(
                commandRepository.findAll(specification, PageRequest.of(
                        normalizedPage, normalizedSize, Sort.by(Sort.Direction.DESC, "requestedAt", "id")
                )),
                commandService::view
        );
    }

    @Transactional(readOnly = true)
    public List<CommandEventView> events(String commandId) {
        if (commandRepository.findByCommandId(commandId).isEmpty()) {
            throw new java.util.NoSuchElementException("Command not found");
        }
        return eventRepository.findByCommandCommandIdOrderByOccurredAtAsc(commandId).stream()
                .map(this::toView)
                .toList();
    }

    private CommandEventView toView(CommandEvent event) {
        return new CommandEventView(
                event.getId(), event.getFromStatus(), event.getToStatus(), event.getEventType(),
                event.getDetail(), readJson(event.getPayloadJson()), event.getOccurredAt()
        );
    }

    private Map<String, Object> readJson(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return objectMapper.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() { });
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
