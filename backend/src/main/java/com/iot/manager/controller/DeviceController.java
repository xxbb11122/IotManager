package com.iot.manager.controller;

import com.iot.manager.dto.DeviceCreateRequest;
import com.iot.manager.dto.DeviceUpdateRequest;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.service.DeviceService;
import com.iot.manager.service.SiteAccessService;
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
@RequestMapping({"/api/devices", "/api/v1/devices"})
@RequiredArgsConstructor
public class DeviceController {

    private final DeviceService deviceService;
    private final SiteAccessService siteAccessService;

    @GetMapping
    public List<DeviceView> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String siteCode
    ) {
        return deviceService.getAllViews(status, type, search, siteAccessService.siteIdsFor(siteCode));
    }

    @GetMapping("/{id}")
    public DeviceView get(@PathVariable Long id) {
        siteAccessService.requireDeviceAccess(id);
        return deviceService.getViewById(id)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
    }

    @GetMapping("/by-device-id/{deviceId}")
    public DeviceView getByDeviceId(@PathVariable String deviceId) {
        siteAccessService.requireDeviceAccessByDeviceId(deviceId);
        return deviceService.getViewByDeviceId(deviceId)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
    }

    @PostMapping
    public ResponseEntity<DeviceView> create(
            @Valid @RequestBody DeviceCreateRequest request,
            @RequestParam(required = false) String siteCode
    ) {
        if (!siteAccessService.isScopeEnforced()) {
            return ResponseEntity.ok(deviceService.create(request));
        }
        var site = siteAccessService.requireSiteAccess(siteCode);
        return ResponseEntity.ok(deviceService.create(request, siteAccessService.requireDefaultSpace(site)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<DeviceView> update(
            @PathVariable Long id,
            @Valid @RequestBody DeviceUpdateRequest request
    ) {
        siteAccessService.requireDeviceAccess(id);
        return ResponseEntity.ok(deviceService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        siteAccessService.requireDeviceAccess(id);
        deviceService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/stats")
    public Map<String, Object> stats(@RequestParam(required = false) String siteCode) {
        return deviceService.getDashboardStats(siteAccessService.siteIdsFor(siteCode));
    }
}
