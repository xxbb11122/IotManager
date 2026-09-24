package com.iot.manager.controller;

import com.iot.manager.config.TimeProperties;
import com.iot.manager.dto.ServerTimeView;
import com.iot.manager.service.PlatformMetricsService;
import com.iot.manager.service.TimeProvider;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * A deliberately small diagnostic endpoint.  It publishes no deployment
 * details and must never be used to override the server's own decisions.
 */
@RestController
@RequestMapping({"/api/time", "/api/v1/time"})
@RequiredArgsConstructor
public class TimeController {

    private final TimeProvider timeProvider;
    private final TimeProperties timeProperties;
    private final PlatformMetricsService platformMetricsService;

    @GetMapping
    public ServerTimeView currentTime() {
        platformMetricsService.timeEndpointRequested();
        String requestId = MDC.get("requestId");
        return new ServerTimeView(
                timeProvider.now(),
                "UTC",
                timeProperties.getClockSkewTolerance().toSeconds(),
                requestId == null || requestId.isBlank() ? null : requestId
        );
    }
}
