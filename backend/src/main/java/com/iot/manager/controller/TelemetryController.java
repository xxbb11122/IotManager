package com.iot.manager.controller;

import com.iot.manager.service.TelemetryService;
import com.iot.manager.service.SiteAccessService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping({"/api/devices", "/api/v1/devices"})
@RequiredArgsConstructor
public class TelemetryController {

    private final TelemetryService telemetryService;
    private final SiteAccessService siteAccessService;

    @GetMapping("/{id}/telemetry")
    public List<Map<String, Object>> telemetry(
            @PathVariable Long id,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime to
    ) {
        siteAccessService.requireDeviceAccess(id);
        return telemetryService.history(id, from, to);
    }
}
