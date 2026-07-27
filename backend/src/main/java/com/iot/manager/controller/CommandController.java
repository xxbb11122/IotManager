package com.iot.manager.controller;

import com.iot.manager.dto.ActivityView;
import com.iot.manager.dto.DeviceCommandRequest;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.service.ActivityService;
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

    @GetMapping("/devices/{id}/activity")
    public List<ActivityView> activity(@PathVariable Long id) {
        return activityService.getByDeviceId(id);
    }
}
