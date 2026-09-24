package com.iot.manager.migration;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.DriverManager;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * R1 production-database guard. It is skipped automatically on developer
 * machines without Docker and runs unchanged in Docker-capable CI.
 */
@Testcontainers(disabledWithoutDocker = true)
class PostgresFlywaySmokeTest {

    private static final Path MIGRATION_ROOT = Path.of("src", "main", "resources", "db");
    private static final Pattern MIGRATION_FILE = Pattern.compile("V(\\d+)__.+\\.sql");

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("iot_manager_test")
            .withUsername("iot_manager")
            .withPassword("test-only-password");

    @Test
    void latestFlywayMigrationsApplyToPostgres16() throws Exception {
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration", "classpath:db/migration-postgresql")
                .load();

        Map<Integer, String> postgresMigrations = postgresMigrationInventory();
        assertThat(postgresMigrations).doesNotContainKey(19);
        assertThat(postgresMigrations).containsKeys(20, 21, 22, 23, 24, 25);
        assertThat(flyway.info().pending())
                .as("resolved PostgreSQL migrations before applying them")
                .hasSize(postgresMigrations.size());

        var migrationResult = flyway.migrate();
        assertThat(migrationResult.migrationsExecuted).isEqualTo(postgresMigrations.size());
        assertThat(flyway.info().pending()).isEmpty();
        assertThat(flyway.info().current().getVersion().getVersion())
                .isEqualTo(String.valueOf(postgresMigrations.keySet().stream().mapToInt(Integer::intValue).max().orElseThrow()));

        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        ); var statement = connection.createStatement(); var result = statement.executeQuery("""
                INSERT INTO devices (name, device_id, profile_id, profile_version)
                VALUES ('PostgreSQL migration smoke device', 'postgres-migration-smoke', 'smoke-v1', 1)
                RETURNING public_id
                """)) {
            assertThat(result.next()).isTrue();
            assertThat(result.getString(1)).startsWith("device-");
        }

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

        assertColumnUsesTextType("device_profiles", "definition_json");
        assertColumnUsesTextType("edge_agents", "metadata_json");
        assertColumnUsesTextType("site_weather_snapshots", "raw_payload_json");
        assertColumnExists("device_telemetry_samples", "observed_time_trust"); // V20
        assertTableExists("retention_job_runs"); // V21
        assertColumnExists("edge_agents", "clock_skew_streak"); // V22
        assertTableExists("retention_watermarks"); // V23
        assertColumnUsesTextType("device_telemetry_samples_archive", "state_json"); // V24
        assertIndexExists("idx_device_commands_completed_utc"); // V25
    }

    private Map<Integer, String> postgresMigrationInventory() throws Exception {
        Map<Integer, String> versions = new TreeMap<>();
        for (String location : new String[]{"migration", "migration-postgresql"}) {
            Path directory = MIGRATION_ROOT.resolve(location);
            assertThat(directory).as("migration location %s", location).isDirectory();
            try (var files = Files.list(directory)) {
                for (Path file : files.filter(Files::isRegularFile).filter(path -> path.toString().endsWith(".sql")).toList()) {
                    String filename = file.getFileName().toString();
                    Matcher matcher = MIGRATION_FILE.matcher(filename);
                    assertThat(matcher.matches()).as("Flyway migration filename %s", filename).isTrue();
                    int version = Integer.parseInt(matcher.group(1));
                    assertThat(versions.putIfAbsent(version, location + "/" + filename))
                            .as("duplicate effective PostgreSQL migration version V%s", version)
                            .isNull();
                }
            }
        }
        return versions;
    }

    private void assertColumnExists(String tableName, String columnName) throws Exception {
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        ); var statement = connection.prepareStatement("""
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?
                """)) {
            statement.setString(1, tableName);
            statement.setString(2, columnName);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).as("column %s.%s", tableName, columnName).isEqualTo(1);
            }
        }
    }

    private void assertTableExists(String tableName) throws Exception {
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        ); var statement = connection.prepareStatement("""
                SELECT COUNT(*) FROM information_schema.tables
                WHERE table_schema = current_schema() AND table_name = ?
                """)) {
            statement.setString(1, tableName);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).as("table %s", tableName).isEqualTo(1);
            }
        }
    }

    private void assertIndexExists(String indexName) throws Exception {
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        ); var statement = connection.prepareStatement("SELECT COUNT(*) FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?")) {
            statement.setString(1, indexName);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).as("index %s", indexName).isEqualTo(1);
            }
        }
    }

    private void assertColumnUsesTextType(String tableName, String columnName) throws Exception {
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        ); var statement = connection.prepareStatement("""
                SELECT data_type
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = ?
                  AND column_name = ?
                """)) {
            statement.setString(1, tableName);
            statement.setString(2, columnName);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString(1)).isEqualTo("text");
            }
        }
    }
}
