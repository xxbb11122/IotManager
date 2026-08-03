package com.iot.manager.controller;

import com.iot.manager.dto.ActivityView;
import com.iot.manager.dto.PageResponse;
import com.iot.manager.dto.CommandEventView;
import com.iot.manager.dto.DeviceCommandRequest;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.service.ActivityService;
import com.iot.manager.service.CommandAuditService;
import com.iot.manager.service.CommandService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class CommandController {

    private final CommandService commandService;
    private final ActivityService activityService;
    private final CommandAuditService commandAuditService;

    @PostMapping("/devices/{id}/commands")
    public ResponseEntity<DeviceCommandView> submit(
            @PathVariable Long id,
            @Valid @RequestBody DeviceCommandRequest request
    ) {
        return ResponseEntity.accepted().body(commandService.submit(id, request));
    }

    @GetMapping("/commands/{commandId}")
    public DeviceCommandView get(@PathVariable String commandId) {
        return commandService.getByCommandId(commandId);
    }

    @GetMapping("/commands")
    public PageResponse<DeviceCommandView> search(
            @org.springframework.web.bind.annotation.RequestParam(required = false) Long deviceId,
            @org.springframework.web.bind.annotation.RequestParam(required = false) String batchId,
            @org.springframework.web.bind.annotation.RequestParam(required = false) String status,
            @org.springframework.web.bind.annotation.RequestParam(required = false) String type,
            @org.springframework.web.bind.annotation.RequestParam(required = false) String deliveryRoute,
            @org.springframework.web.bind.annotation.RequestParam(required = false) String requestOrigin,
            @org.springframework.web.bind.annotation.RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE_TIME) java.time.LocalDateTime from,
            @org.springframework.web.bind.annotation.RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE_TIME) java.time.LocalDateTime to,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "0") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "50") int size
    ) {
        return commandAuditService.search(deviceId, batchId, status, type, deliveryRoute, requestOrigin, from, to, page, size);
    }

    @GetMapping("/commands/{commandId}/events")
    public List<CommandEventView> events(@PathVariable String commandId) {
        return commandAuditService.events(commandId);
    }

    @GetMapping("/devices/{id}/activity")
    public List<ActivityView> activity(@PathVariable Long id) {
        return activityService.getByDeviceId(id);
    }

    @GetMapping("/devices/{id}/history")
    public PageResponse<ActivityView> history(
            @PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "0") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "50") int size
    ) {
        return activityService.history(id, page, size);
    }
}
