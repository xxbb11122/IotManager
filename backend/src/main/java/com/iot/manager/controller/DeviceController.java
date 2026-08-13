package com.iot.manager.controller;

import com.iot.manager.dto.DeviceCreateRequest;
import com.iot.manager.dto.DeviceUpdateRequest;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.service.DeviceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api/devices")
@RequiredArgsConstructor
public class DeviceController {

    private final DeviceService deviceService;

    @GetMapping
    public List<DeviceView> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String search
    ) {
        return deviceService.getAllViews(status, type, search);
    }

    @GetMapping("/{id}")
    public DeviceView get(@PathVariable Long id) {
        return deviceService.getViewById(id)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
    }

    @GetMapping("/by-device-id/{deviceId}")
    public DeviceView getByDeviceId(@PathVariable String deviceId) {
        return deviceService.getViewByDeviceId(deviceId)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
    }

    @PostMapping
    public ResponseEntity<DeviceView> create(@Valid @RequestBody DeviceCreateRequest request) {
        return ResponseEntity.ok(deviceService.create(request));
    }

    @PutMapping("/{id}")
    public ResponseEntity<DeviceView> update(
            @PathVariable Long id,
            @Valid @RequestBody DeviceUpdateRequest request
    ) {
        return ResponseEntity.ok(deviceService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        deviceService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        return deviceService.getDashboardStats();
    }
}
