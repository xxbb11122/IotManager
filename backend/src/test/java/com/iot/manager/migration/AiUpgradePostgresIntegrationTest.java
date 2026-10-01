package com.iot.manager.migration;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.sql.DriverManager;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers(disabledWithoutDocker = true)
class AiUpgradePostgresIntegrationTest {
    private static final String MIGRATION_USER = "ai_migration_owner";
    private static final String MIGRATION_PASSWORD = "test-only-migration-password";

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            DockerImageName.parse("pgvector/pgvector:0.8.6-pg16").asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("ai_upgrade_test")
            .withUsername("iot_admin_test")
            .withPassword("test-only-admin-password");

    @Test
    void oldV25DatabaseUpgradesAfterAdminInstallsVectorWithNonSuperuserFlyway() throws Exception {
        try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var statement = connection.createStatement()) {
            statement.execute("CREATE ROLE " + MIGRATION_USER + " LOGIN NOSUPERUSER PASSWORD '" + MIGRATION_PASSWORD + "'");
            statement.execute("ALTER DATABASE ai_upgrade_test OWNER TO " + MIGRATION_USER);
            statement.execute("ALTER SCHEMA public OWNER TO " + MIGRATION_USER);
        }
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), MIGRATION_USER, MIGRATION_PASSWORD)
                .locations("classpath:db/migration", "classpath:db/migration-postgresql")
                .target(MigrationVersion.fromVersion("25")).load().migrate();
        try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var statement = connection.createStatement()) {
            statement.execute("CREATE EXTENSION vector VERSION '0.8.6'");
        }
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), MIGRATION_USER, MIGRATION_PASSWORD)
                .locations("classpath:db/migration", "classpath:db/migration-postgresql")
                .load().migrate();
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), MIGRATION_USER, MIGRATION_PASSWORD));
        assertThat(jdbc.queryForObject("SELECT MAX(installed_rank) FROM flyway_schema_history WHERE success = true", Integer.class))
                .isPositive();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai_chunk_vectors", Long.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT extversion FROM pg_extension WHERE extname = 'vector'", String.class))
                .isEqualTo("0.8.6");
        assertThat(jdbc.queryForObject("SELECT rolsuper FROM pg_roles WHERE rolname = ?", Boolean.class, MIGRATION_USER))
                .isFalse();
        Long site=jdbc.queryForObject("SELECT id FROM sites ORDER BY id LIMIT 1",Long.class);
        // The previous backend does not know V28's new nullable columns.
        jdbc.update("INSERT INTO ai_conversations(id,site_id,owner_subject,persona_version,created_at,updated_at) VALUES('rollback-conversation',?,'owner',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",site);
        jdbc.update("INSERT INTO ai_messages(id,site_id,conversation_id,role,content,created_at) VALUES('rollback-message',?,'rollback-conversation','USER','legacy write',CURRENT_TIMESTAMP)",site);
        assertThat(jdbc.queryForObject("SELECT message_sequence FROM ai_messages WHERE id='rollback-message'",Long.class)).isNull();
        jdbc.update("INSERT INTO ai_chat_requests(id,site_id,actor_subject,client_key,input_hash,conversation_id,state,created_at,deadline_at,expires_at,tombstone_until) VALUES('rollback-request',?,'owner','rollback-key',?,'rollback-conversation','DELETED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",site,"0".repeat(64));
        jdbc.update("DELETE FROM ai_conversations WHERE id='rollback-conversation'");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai_messages WHERE id='rollback-message'",Long.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT state FROM ai_chat_requests WHERE id='rollback-request'",String.class)).isEqualTo("DELETED");
        // Flyway's older binary can validate its known migrations after rollback.
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),MIGRATION_USER,MIGRATION_PASSWORD)
                .locations("classpath:db/migration","classpath:db/migration-postgresql")
                .target(MigrationVersion.fromVersion("27")).load().validate();
    }
}
