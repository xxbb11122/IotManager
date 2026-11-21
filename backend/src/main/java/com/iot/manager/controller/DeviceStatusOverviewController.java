package com.iot.manager.controller;

import com.iot.manager.service.DeviceStatusOverviewService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/sites/{siteId}/device-status-overview")
public class DeviceStatusOverviewController {
    private final DeviceStatusOverviewService overview;

    @GetMapping
    public ResponseEntity<DeviceStatusOverviewService.Overview> list(@PathVariable long siteId,
            @RequestParam(required = false) String cursor, @RequestParam(defaultValue = "50") int limit) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(overview.list(siteId, cursor, limit));
    }

    @GetMapping("/{publicId}")
    public ResponseEntity<DeviceStatusOverviewService.DeviceEvidence> detail(@PathVariable long siteId,
            @PathVariable String publicId, @RequestParam(required = false) String commandId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(overview.detail(siteId, publicId, commandId));
    }
}
