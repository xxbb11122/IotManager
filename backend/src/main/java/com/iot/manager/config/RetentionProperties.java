package com.iot.manager.config;

import jakarta.annotation.PostConstruct;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "iot.retention")
public class RetentionProperties {

    private boolean enabled = false;
    private boolean dryRun = true;
    private int batchSize = 5_000;
    private Duration lockLease = Duration.ofMinutes(45);
    private Duration batchTimeout = Duration.ofMinutes(2);
    private Duration telemetryHot = Duration.ofDays(90);
    private Duration telemetryTotal = Duration.ofDays(365);
    private Duration audit = Duration.ofDays(730);
    private Duration command = Duration.ofDays(730);
    private Duration alert = Duration.ofDays(365);
    private Duration weatherSnapshot = Duration.ofDays(90);
    private Duration weatherForecast = Duration.ofDays(30);
    private Duration credentialRotation = Duration.ofDays(730);

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public boolean isDryRun() { return dryRun; }
    public void setDryRun(boolean dryRun) { this.dryRun = dryRun; }
    public int getBatchSize() { return batchSize; }
    public void setBatchSize(int batchSize) {
        if (batchSize < 1 || batchSize > 5_000) throw new IllegalArgumentException("iot.retention.batch-size must be between 1 and 5000");
        this.batchSize = batchSize;
    }
    public Duration getLockLease() { return lockLease; }
    public void setLockLease(Duration lockLease) { this.lockLease = positive(lockLease, "lock-lease"); }
    public Duration getBatchTimeout() { return batchTimeout; }
    public void setBatchTimeout(Duration batchTimeout) {
        Duration value = positive(batchTimeout, "batch-timeout");
        if (value.compareTo(Duration.ofSeconds(1)) < 0 || value.compareTo(Duration.ofMinutes(10)) > 0) {
            throw new IllegalArgumentException("iot.retention.batch-timeout must be between 1s and 10m");
        }
        this.batchTimeout = value;
    }
    public Duration getTelemetryHot() { return telemetryHot; }
    public void setTelemetryHot(Duration telemetryHot) { this.telemetryHot = positive(telemetryHot, "telemetry-hot"); }
    public Duration getTelemetryTotal() { return telemetryTotal; }
    public void setTelemetryTotal(Duration telemetryTotal) { this.telemetryTotal = positive(telemetryTotal, "telemetry-total"); }
    public Duration getAudit() { return audit; }
    public void setAudit(Duration audit) { this.audit = positive(audit, "audit"); }
    public Duration getCommand() { return command; }
    public void setCommand(Duration command) { this.command = positive(command, "command"); }
    public Duration getAlert() { return alert; }
    public void setAlert(Duration alert) { this.alert = positive(alert, "alert"); }
    public Duration getWeatherSnapshot() { return weatherSnapshot; }
    public void setWeatherSnapshot(Duration weatherSnapshot) { this.weatherSnapshot = positive(weatherSnapshot, "weather-snapshot"); }
    public Duration getWeatherForecast() { return weatherForecast; }
    public void setWeatherForecast(Duration weatherForecast) { this.weatherForecast = positive(weatherForecast, "weather-forecast"); }
    public Duration getCredentialRotation() { return credentialRotation; }
    public void setCredentialRotation(Duration credentialRotation) { this.credentialRotation = positive(credentialRotation, "credential-rotation"); }

    public void validateOrdering() {
        // These are the approved minimums, not tuning knobs. Shortening them
        // requires a reviewed policy/code change rather than an env override.
        if (telemetryHot.compareTo(Duration.ofDays(90)) < 0
                || telemetryTotal.compareTo(Duration.ofDays(365)) < 0
                || audit.compareTo(Duration.ofDays(730)) < 0
                || command.compareTo(Duration.ofDays(730)) < 0) {
            throw new IllegalArgumentException("R1 retention durations cannot be shorter than the approved baseline");
        }
        if (telemetryTotal.compareTo(telemetryHot) <= 0) {
            throw new IllegalArgumentException("iot.retention.telemetry-total must exceed telemetry-hot");
        }
        if (lockLease.compareTo(batchTimeout.multipliedBy(2)) <= 0) {
            throw new IllegalArgumentException("iot.retention.lock-lease must exceed twice batch-timeout");
        }
    }

    @PostConstruct
    void validate() {
        validateOrdering();
    }

    private static Duration positive(Duration value, String property) {
        if (value == null || value.isNegative() || value.isZero()) {
            throw new IllegalArgumentException("iot.retention." + property + " must be positive");
        }
        return value;
    }
}
