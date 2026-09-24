package com.iot.manager.controller;

import com.iot.manager.service.TelemetryService;
import com.iot.manager.service.SiteAccessService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
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
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to
    ) {
        siteAccessService.requireDeviceAccess(id);
        return telemetryService.historyByReceivedAt(id, parseTime(from, "from"), parseTime(to, "to"));
    }

    @GetMapping("/{id}/telemetry/archive")
    public TelemetryService.ArchivePage archivedTelemetry(
            @PathVariable Long id,
            @RequestParam String from,
            @RequestParam String to,
            @RequestParam(required = false) String afterReceivedAt,
            @RequestParam(required = false) Long afterId,
            @RequestParam(defaultValue = "200") int limit
    ) {
        siteAccessService.requireDeviceAccess(id);
        return telemetryService.archiveHistory(id, parseTime(from, "from"), parseTime(to, "to"),
                parseTime(afterReceivedAt, "afterReceivedAt"), afterId, limit);
    }

    /**
     * New callers must send an offset/Z-bearing RFC 3339 instant.  A naïve
     * legacy timestamp is retained for one compatibility window and is
     * explicitly interpreted as the historical UTC storage representation,
     * never as the web server's local wall clock.
     */
    private Instant parseTime(String value, String parameter) {
        if (value == null || value.isBlank()) return null;
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException ignored) {
            try {
                return OffsetDateTime.parse(value).toInstant();
            } catch (DateTimeParseException ignoredAgain) {
                try {
                    return LocalDateTime.parse(value).toInstant(ZoneOffset.UTC);
                } catch (DateTimeParseException exception) {
                    throw new IllegalArgumentException(parameter + " must be an ISO-8601 instant");
                }
            }
        }
    }
}
