package com.iot.manager.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.sql.SQLException;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * Keeps fixed-delay database work quiet and retryable while PostgreSQL is
 * deliberately restarting or temporarily unavailable. It only absorbs known
 * connection-loss SQL states; programming, validation, and data errors still
 * reach Spring's scheduler error handler as actionable failures.
 */
@Component
@Slf4j
public class ScheduledDatabaseTaskGuard {

    private static final long WARNING_INTERVAL_MILLIS = 30_000L;
    private static final Set<String> DATABASE_UNAVAILABLE_SQL_STATES = Set.of("57P01", "57P02", "57P03");
    // A PostgreSQL stop can close Hikari's connection before Hibernate reaches
    // the server, leaving the driver without an SQLState while it rolls a
    // transaction back. Limit this fallback to SQLException messages so an
    // unrelated application exception can never be mistaken for an outage.
    private static final Set<String> DATABASE_UNAVAILABLE_MESSAGE_MARKERS = Set.of(
            "connection is closed",
            "connection has been closed",
            "this connection has been closed",
            "connection is not available",
            "connection refused"
    );

    private final ConcurrentMap<String, Long> lastWarningAtMillis = new ConcurrentHashMap<>();

    public void run(String taskName, Runnable task) {
        try {
            task.run();
        } catch (RuntimeException exception) {
            if (!isTransientDatabaseFailure(exception)) {
                throw exception;
            }
            warnAtMostOncePerInterval(taskName, exception);
        }
    }

    boolean isTransientDatabaseFailure(Throwable exception) {
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        for (Throwable current = exception; current != null && seen.add(current); current = current.getCause()) {
            if (current instanceof SQLException sqlException) {
                String sqlState = sqlException.getSQLState();
                if (sqlState != null && (sqlState.startsWith("08") || DATABASE_UNAVAILABLE_SQL_STATES.contains(sqlState))) {
                    return true;
                }
                String message = sqlException.getMessage();
                if (message != null) {
                    String normalizedMessage = message.toLowerCase(Locale.ROOT);
                    if (DATABASE_UNAVAILABLE_MESSAGE_MARKERS.stream().anyMatch(normalizedMessage::contains)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private void warnAtMostOncePerInterval(String taskName, RuntimeException exception) {
        long now = System.currentTimeMillis();
        Long previous = lastWarningAtMillis.putIfAbsent(taskName, now);
        if (previous == null || now - previous >= WARNING_INTERVAL_MILLIS) {
            lastWarningAtMillis.put(taskName, now);
            log.warn("Scheduled database task {} skipped because PostgreSQL is unavailable; it will retry on its next interval: {}",
                    taskName, mostSpecificMessage(exception));
        }
    }

    private String mostSpecificMessage(Throwable exception) {
        Throwable current = exception;
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        while (current.getCause() != null && seen.add(current)) {
            current = current.getCause();
        }
        return current.getMessage() == null ? current.getClass().getSimpleName() : current.getMessage();
    }
}
