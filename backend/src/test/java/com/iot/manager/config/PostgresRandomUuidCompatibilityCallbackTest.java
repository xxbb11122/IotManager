package com.iot.manager.config;

import org.flywaydb.core.api.callback.Event;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PostgresRandomUuidCompatibilityCallbackTest {

    private final PostgresRandomUuidCompatibilityCallback callback = new PostgresRandomUuidCompatibilityCallback();

    @Test
    void requestsAFlywayEventConnectionBeforeTheDatabaseContextIsAvailable() {
        assertThat(callback.supports(Event.BEFORE_MIGRATE, null)).isTrue();
        assertThat(callback.supports(Event.BEFORE_VALIDATE, null)).isFalse();
    }
}
