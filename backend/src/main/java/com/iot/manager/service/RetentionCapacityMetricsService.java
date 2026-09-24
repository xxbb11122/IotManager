package com.iot.manager.service;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/** Low-cardinality capacity signals for tables governed by R1 retention. */
@Service
@Slf4j
public class RetentionCapacityMetricsService {

    private static final Map<String, String> OLDEST_COLUMNS = oldestColumns();

    private final JdbcTemplate jdbcTemplate;
    private final DataSource dataSource;
    private final TimeProvider timeProvider;
    private final Map<String, AtomicLong> tableBytes = new LinkedHashMap<>();
    private final Map<String, AtomicLong> oldestAgeSeconds = new LinkedHashMap<>();

    public RetentionCapacityMetricsService(
            JdbcTemplate jdbcTemplate, DataSource dataSource, TimeProvider timeProvider, MeterRegistry registry
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.dataSource = dataSource;
        this.timeProvider = timeProvider;
        OLDEST_COLUMNS.forEach((table, ignored) -> {
            AtomicLong bytes = new AtomicLong(-1);
            AtomicLong age = new AtomicLong(-1);
            tableBytes.put(table, bytes);
            oldestAgeSeconds.put(table, age);
            Gauge.builder("iot.retention.table.bytes", bytes, AtomicLong::get)
                    .tag("table", table).description("PostgreSQL table, index and TOAST bytes; -1 if unavailable")
                    .register(registry);
            Gauge.builder("iot.retention.oldest.age.seconds", age, AtomicLong::get)
                    .tag("table", table).description("Age of oldest authoritative row; -1 if absent")
                    .register(registry);
        });
    }

    @Scheduled(
            fixedDelayString = "${iot.retention.capacity-sample-ms:600000}",
            initialDelayString = "${iot.retention.capacity-sample-initial-delay-ms:60000}"
    )
    public void sample() {
        boolean postgresql;
        try (Connection connection = dataSource.getConnection()) {
            postgresql = "PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName());
        } catch (Exception exception) {
            log.debug("Retention capacity sample could not identify the database", exception);
            return;
        }
        Instant now = timeProvider.now();
        OLDEST_COLUMNS.forEach((table, column) -> {
            try {
                Timestamp oldest = jdbcTemplate.queryForObject(
                        "SELECT MIN(" + column + ") FROM " + table, Timestamp.class);
                oldestAgeSeconds.get(table).set(oldest == null
                        ? -1 : Math.max(0, Duration.between(oldest.toInstant(), now).getSeconds()));
                Long bytes = postgresql ? jdbcTemplate.queryForObject(
                        "SELECT pg_total_relation_size(to_regclass(?))", Long.class, table) : null;
                tableBytes.get(table).set(bytes == null ? -1 : bytes);
            } catch (Exception exception) {
                oldestAgeSeconds.get(table).set(-1);
                tableBytes.get(table).set(-1);
                log.debug("Retention capacity sample for {} is unavailable", table, exception);
            }
        });
    }

    private static Map<String, String> oldestColumns() {
        Map<String, String> columns = new LinkedHashMap<>();
        columns.put("device_telemetry_samples", "received_at");
        columns.put("device_telemetry_samples_archive", "received_at");
        columns.put("activity_events", "occurred_at_utc");
        columns.put("command_events", "occurred_at_utc");
        columns.put("device_commands", "completed_at_utc");
        columns.put("alerts", "resolved_at_utc");
        columns.put("site_weather_snapshots", "fetched_at");
        columns.put("site_weather_forecast_points", "fetched_at");
        columns.put("weather_provider_access_events", "occurred_at");
        columns.put("credential_rotations", "occurred_at_utc");
        columns.put("retention_holds", "created_at");
        columns.put("retention_job_runs", "started_at");
        return Map.copyOf(columns);
    }
}
