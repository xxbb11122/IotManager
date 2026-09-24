package com.iot.manager.dto;

import java.time.Instant;

public record ServerTimeView(
        Instant serverTime,
        String zone,
        long skewToleranceSeconds,
        String requestId
) {
}
