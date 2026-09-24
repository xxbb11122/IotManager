package com.iot.manager.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.time.ZoneId;

@ConfigurationProperties(prefix = "iot.time")
public class TimeProperties {

    /**
     * A one-way edge timestamp also includes network transit time, therefore
     * this is deliberately a diagnostic tolerance rather than an availability
     * threshold.
     */
    private Duration clockSkewTolerance = Duration.ofSeconds(30);
    /** Zone used by N-1's server-authored LocalDateTime columns. */
    private String legacyZone = "Asia/Shanghai";

    public Duration getClockSkewTolerance() {
        return clockSkewTolerance;
    }

    public void setClockSkewTolerance(Duration clockSkewTolerance) {
        if (clockSkewTolerance == null || clockSkewTolerance.isNegative() || clockSkewTolerance.isZero()) {
            throw new IllegalArgumentException("iot.time.clock-skew-tolerance must be positive");
        }
        this.clockSkewTolerance = clockSkewTolerance;
    }

    public String getLegacyZone() {
        return legacyZone;
    }

    public void setLegacyZone(String legacyZone) {
        if (legacyZone == null || legacyZone.isBlank()) {
            throw new IllegalArgumentException("iot.time.legacy-zone must be an IANA zone ID");
        }
        ZoneId.of(legacyZone);
        this.legacyZone = legacyZone;
    }
}
