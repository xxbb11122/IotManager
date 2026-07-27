package com.iot.manager.controller;

import com.iot.manager.entity.Alert;
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

    /** 活跃告警 */
    @GetMapping("/active")
    public List<Alert> activeAlerts() {
        return deviceService.getActiveAlerts();
    }

    /** 最近告警 */
    @GetMapping
    public List<Alert> recentAlerts() {
        return deviceService.getRecentAlerts();
    }

    /** 解决告警 */
    @PutMapping("/{id}/resolve")
    public ResponseEntity<Alert> resolve(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(deviceService.resolveAlert(id));
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        }
    }
}
