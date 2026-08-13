package com.iot.manager.controller;

import com.iot.manager.dto.AlertView;
import com.iot.manager.dto.PageResponse;
import com.iot.manager.service.AlertService;
import com.iot.manager.service.DeviceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/alerts")
@RequiredArgsConstructor
public class AlertController {

    private final DeviceService deviceService;
    private final AlertService alertService;

    /** 活跃告警 */
    @GetMapping("/active")
    public List<AlertView> activeAlerts() {
        return alertService.active();
    }

    /** 最近告警 */
    @GetMapping
    public List<AlertView> recentAlerts() {
        return alertService.recent();
    }

    @GetMapping("/search")
    public PageResponse<AlertView> search(
            @RequestParam(required = false) Boolean resolved,
            @RequestParam(required = false) List<String> levels,
            @RequestParam(required = false) String groupId,
            @RequestParam(required = false) Long deviceId,
            @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE_TIME) java.time.LocalDateTime from,
            @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE_TIME) java.time.LocalDateTime to,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size
    ) {
        return alertService.search(resolved, levels, groupId, deviceId, from, to, q, page, size);
    }

    /** 解决告警 */
    @PutMapping("/{id}/resolve")
    public ResponseEntity<AlertView> resolve(@PathVariable Long id) {
        try {
            deviceService.resolveAlert(id);
            return ResponseEntity.ok(alertService.getView(id));
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        }
    }
}
