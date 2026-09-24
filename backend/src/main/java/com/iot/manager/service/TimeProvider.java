package com.iot.manager.service;

import com.iot.manager.config.TimeProperties;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;

/**
 * Keeps all service-side time decisions on one injectable UTC clock.  The
 * LocalDateTime helpers exist only while legacy columns remain during the
 * Expand/Contract compatibility window. New decisions must use now(). Old
 * server-authored columns use the recorded N-1 deployment zone; source/edge
 * timestamps formerly decoded as UTC use legacyUtc().
 */
@Component
public class TimeProvider {

    private final Clock clock;
    private final ZoneId legacyZone;

    public TimeProvider(Clock clock, TimeProperties properties) {
        this.clock = clock;
        this.legacyZone = ZoneId.of(properties.getLegacyZone());
    }

    public Instant now() {
        return clock.instant();
    }

    public long currentTimeMillis() {
        return now().toEpochMilli();
    }

    /** Only for legacy columns whose old writer explicitly decoded UTC. */
    public LocalDateTime legacyUtc(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    /** For old columns originally written with LocalDateTime.now() in N-1. */
    public LocalDateTime legacyServer(Instant instant) {
        return LocalDateTime.ofInstant(instant, legacyZone);
    }

    public LocalDateTime legacyServerNow() {
        return legacyServer(now());
    }

    public Instant legacyServerInstant(LocalDateTime localDateTime) {
        return localDateTime.atZone(legacyZone).toInstant();
    }
}
