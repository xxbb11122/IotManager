package com.iot.manager.service;

import org.junit.jupiter.api.Test;

import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScheduledDatabaseTaskGuardTest {

    private final ScheduledDatabaseTaskGuard guard = new ScheduledDatabaseTaskGuard();

    @Test
    void absorbsPostgreSqlRestartAndConnectionFailureStates() {
        AtomicBoolean invoked = new AtomicBoolean();

        assertThatCode(() -> guard.run("edge-timeout", () -> {
            invoked.set(true);
            throw new RuntimeException(new SQLException("database is restarting", "57P01"));
        })).doesNotThrowAnyException();

        assertThat(invoked).isTrue();
        assertThat(guard.isTransientDatabaseFailure(new RuntimeException(new SQLException("connection lost", "08006"))))
                .isTrue();
        // Hibernate can throw this during rollback after the pool has already
        // closed the JDBC connection, so there is no SQLState to inspect.
        assertThat(guard.isTransientDatabaseFailure(new RuntimeException(new SQLException("Connection is closed"))))
                .isTrue();
    }

    @Test
    void rethrowsNonConnectivityFailures() {
        assertThatThrownBy(() -> guard.run("edge-timeout", () -> {
            throw new IllegalStateException("invalid command payload");
        })).isInstanceOf(IllegalStateException.class)
                .hasMessage("invalid command payload");
    }
}
