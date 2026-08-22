package com.iot.manager.service;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Low-cardinality metrics only. IDs, usernames, site codes and command payloads
 * are deliberately excluded from Prometheus labels.
 */
@Service
public class PlatformMetricsService {

    private final MeterRegistry meterRegistry;
    private final AtomicInteger activeWebSocketSessions = new AtomicInteger();

    public PlatformMetricsService(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
        Gauge.builder("iot.websocket.sessions.active", activeWebSocketSessions, AtomicInteger::get)
                .description("Currently connected client WebSocket sessions")
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

    private Counter counter(String name, String tagName, String tagValue) {
        return Counter.builder(name).tag(tagName, tagValue).register(meterRegistry);
    }

    private String normalized(String raw) {
        String value = raw == null ? "unknown" : raw.trim().toLowerCase(Locale.ROOT);
        if (value.isEmpty()) return "unknown";
        return value.matches("[a-z0-9_.-]{1,40}") ? value : "other";
    }
}
