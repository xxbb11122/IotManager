package com.iot.manager.migration;

import com.iot.manager.config.PostgresRandomUuidCompatibilityCallback;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.DriverManager;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * R1 production-database guard. It is skipped automatically on developer
 * machines without Docker and runs unchanged in Docker-capable CI.
 */
@Testcontainers(disabledWithoutDocker = true)
class PostgresFlywaySmokeTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("iot_manager_test")
            .withUsername("iot_manager")
            .withPassword("test-only-password");

    @Test
    void latestFlywayMigrationsApplyToPostgres16() throws Exception {
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .callbacks(new PostgresRandomUuidCompatibilityCallback())
                .load();

        assertThat(flyway.migrate().migrationsExecuted).isEqualTo(18);
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("18");

        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        ); var statement = connection.createStatement(); var result = statement.executeQuery("""
                SELECT COUNT(*)
                FROM information_schema.columns
                WHERE table_name = 'site_weather_settings'
                  AND column_name IN ('last_refresh_outcome', 'last_refresh_duration_ms')
                """)) {
            assertThat(result.next()).isTrue();
            assertThat(result.getInt(1)).isEqualTo(2);
        }

        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        ); var statement = connection.createStatement(); var result = statement.executeQuery("SELECT public.random_uuid()")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getObject(1)).isNotNull();
        }
    }
}
