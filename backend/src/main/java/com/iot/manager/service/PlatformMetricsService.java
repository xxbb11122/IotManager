package com.iot.manager.service;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Low-cardinality metrics only. IDs, usernames, site codes and command payloads
 * are deliberately excluded from Prometheus labels.
 */
@Service
public class PlatformMetricsService {

    private final MeterRegistry meterRegistry;
    private final AtomicInteger activeWebSocketSessions = new AtomicInteger();
    private final AtomicLong edgeAgentClockSkewMillis = new AtomicLong();

    public PlatformMetricsService(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
        Gauge.builder("iot.websocket.sessions.active", activeWebSocketSessions, AtomicInteger::get)
                .description("Currently connected client WebSocket sessions")
                .register(meterRegistry);
        Gauge.builder("iot.agent.clock_skew.seconds", edgeAgentClockSkewMillis,
                        value -> value.get() / 1_000.0d)
                .description("Most recently observed edge-agent clock skew; diagnostic only")
                .register(meterRegistry);
    }

    public void commandTransition(String status) {
        counter("iot.commands.transitions", "status", normalized(status)).increment();
    }

    public void weatherRefresh(String provider, String outcome) {
        Counter.builder("iot.weather.refreshes")
                .tag("provider", normalized(provider))
                .tag("outcome", normalized(outcome))
                .register(meterRegistry)
                .increment();
    }

    public void webSocketOpened() {
        activeWebSocketSessions.incrementAndGet();
        counter("iot.websocket.connections", "event", "opened").increment();
    }

    public void webSocketClosed() {
        activeWebSocketSessions.updateAndGet(value -> Math.max(0, value - 1));
        counter("iot.websocket.connections", "event", "closed").increment();
    }

    public void webSocketEventDelivered(String eventType) {
        counter("iot.websocket.events", "type", normalized(eventType)).increment();
    }

    public void rateLimited(String category) {
        counter("iot.api.rate_limited", "category", normalized(category)).increment();
    }

    public void edgeAgentClockTrust(String trust, Long skewMillis) {
        counter("iot.agent.clock.trust", "status", normalized(trust)).increment();
        if (skewMillis != null) {
            edgeAgentClockSkewMillis.set(skewMillis);
        }
    }

    public void telemetryLegacyTime() {
        counter("iot.telemetry.legacy_time", "status", "legacy_unknown").increment();
    }

    public void timeEndpointRequested() {
        counter("iot.time.endpoint.requests", "result", "success").increment();
    }

    public void retentionRowsArchived(String category, long count) {
        if (count > 0) counter("iot.retention.rows.archived", "category", normalized(category)).increment(count);
    }

    public void retentionRowsDeleted(String category, long count) {
        if (count > 0) counter("iot.retention.rows.deleted", "category", normalized(category)).increment(count);
    }

    public void retentionRowsHeld(String category, long count) {
        if (count > 0) counter("iot.retention.rows.held", "category", normalized(category)).increment(count);
    }

    public void retentionJob(String category, String outcome, java.time.Duration duration) {
        if (!"success".equals(normalized(outcome))) {
            counter("iot.retention.job.failures", "category", normalized(category)).increment();
        }
        Timer.builder("iot.retention.job.duration")
                .tag("category", normalized(category))
                .tag("outcome", normalized(outcome))
                .register(meterRegistry)
                .record(duration);
    }

    private Counter counter(String name, String tagName, String tagValue) {
        return Counter.builder(name).tag(tagName, tagValue).register(meterRegistry);
    }

    private String normalized(String raw) {
        String value = raw == null ? "unknown" : raw.trim().toLowerCase(Locale.ROOT);
        if (value.isEmpty()) return "unknown";
        return value.matches("[a-z0-9_.-]{1,40}") ? value : "other";
    }
}
