package com.iot.manager.ai;

import com.iot.manager.config.TimeProperties;
import com.iot.manager.service.TimeProvider;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.sql.DriverManager;
import java.time.Clock;
import java.time.Instant;
import java.sql.Timestamp;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers(disabledWithoutDocker = true)
class AiVectorPostgresIntegrationTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(
            DockerImageName.parse("pgvector/pgvector:0.8.6-pg16").asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("ai_vector_test")
            .withUsername("iot_test")
            .withPassword("test-only-password");

    @Test
    void exactVectorSearchNeverReturnsAnotherSite() throws Exception {
        try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var statement = connection.createStatement()) {
            statement.execute("CREATE EXTENSION IF NOT EXISTS vector");
        }
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration", "classpath:db/migration-postgresql")
                .load().migrate();
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.update("INSERT INTO organizations (code, name) VALUES ('ai-test-org', 'AI test')");
        Long org = jdbc.queryForObject("SELECT id FROM organizations WHERE code = 'ai-test-org'", Long.class);
        jdbc.update("INSERT INTO sites (organization_id, code, name) VALUES (?, 'ai-a', 'AI A')", org);
        jdbc.update("INSERT INTO sites (organization_id, code, name) VALUES (?, 'ai-b', 'AI B')", org);
        long siteA = jdbc.queryForObject("SELECT id FROM sites WHERE code = 'ai-a'", Long.class);
        long siteB = jdbc.queryForObject("SELECT id FROM sites WHERE code = 'ai-b'", Long.class);
        AiRepository repository = new AiRepository(jdbc, new TimeProvider(Clock.systemUTC(), new TimeProperties()));
        var kbA = repository.createKnowledgeBase(siteA, "Same name", "owner");
        var kbB = repository.createKnowledgeBase(siteB, "Same name", "owner");
        var docA = repository.createDocument(siteA, kbA.id(), "manual.txt", "text/plain", "YQ==", "a", 1, "owner");
        var docB = repository.createDocument(siteB, kbB.id(), "manual.txt", "text/plain", "Yg==", "b", 1, "owner");
        repository.saveChunk(siteA, docA.documentId(), 0, "site A only", null, null, "same-model", new float[]{1, 0, 0});
        repository.saveChunk(siteB, docB.documentId(), 0, "site B only", null, null, "same-model", new float[]{1, 0, 0});
        repository.jobStatus(siteA, docA.id(), "RUNNING", null);
        repository.jobStatus(siteB, docB.id(), "RUNNING", null);
        repository.publishDocument(siteA, docA.documentId(), docA.id());
        repository.publishDocument(siteB, docB.documentId(), docB.id());

        assertThat(repository.search(siteA, "same-model", new float[]{1, 0, 0}, 5))
                .extracting(AiRepository.Hit::content).containsExactly("site A only");
        assertThat(repository.search(siteB, "same-model", new float[]{1, 0, 0}, 5))
                .extracting(AiRepository.Hit::content).containsExactly("site B only");

        var replacement = repository.createDocument(siteA, kbA.id(), "manual.txt", "text/plain",
                "YzI=", "replacement", 2, "owner");
        repository.saveChunk(siteA, replacement.documentId(), 0, "site A current version", null, null,
                "same-model", new float[]{1, 0, 0});
        assertThat(repository.search(siteA, "same-model", new float[]{1, 0, 0}, 5))
                .extracting(AiRepository.Hit::content).containsExactly("site A only");
        repository.jobStatus(siteA, replacement.id(), "RUNNING", null);
        assertThat(repository.publishDocument(siteA, replacement.documentId(), replacement.id())).isTrue();
        assertThat(repository.job(siteA, replacement.id()).status()).isEqualTo("SUCCEEDED");
        assertThat(repository.document(siteA, docA.documentId()).status()).isEqualTo("SUPERSEDED");
        assertThat(repository.search(siteA, "same-model", new float[]{1, 0, 0}, 5))
                .extracting(AiRepository.Hit::content).containsExactly("site A current version");
        repository.activateDocumentVersion(siteA, docA.documentId());
        assertThat(repository.search(siteA, "same-model", new float[]{1, 0, 0}, 5))
                .extracting(AiRepository.Hit::content).containsExactly("site A only");

        for (int i = 0; i < 21; i++) {
            String id = String.format("sensor-%03d", i);
            jdbc.update("""
                    INSERT INTO devices (name, device_id, public_id, profile_id, profile_version,
                                         site_id, status, last_received_at)
                    VALUES (?, ?, ?, 'test-profile', 1, ?, 'ONLINE', ?)
                    """, "Sensor " + i, id, id, siteA, Timestamp.from(Instant.now()));
        }
        assertThat(repository.deviceStatus(siteA, "请查看 sensor-020 的设备状态"))
                .singleElement().asString().contains("sensor-020", "recent observation");
        assertThat(repository.deviceStatus(siteB, "请查看 sensor-020 的设备状态")).isEmpty();
        jdbc.update("UPDATE devices SET last_received_at = ? WHERE public_id = 'sensor-020'",
                Timestamp.from(Instant.now().minusSeconds(600)));
        assertThat(repository.deviceStatus(siteA, "请查看 sensor-020 的设备状态"))
                .singleElement().asString().contains("STALE: current status unknown");
    }
}
