package com.iot.manager.ai;

import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.Map;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "iot.ai.enabled=true",
        "iot.ai.knowledge-enabled=true",
        "iot.ai.allowed-hosts[0]=example.test",
        "spring.ai.openai.chat.base-url=https://example.test",
        "spring.ai.openai.embedding.base-url=https://example.test",
        "spring.ai.openai.chat.api-key=test-only-chat-key",
        "spring.ai.openai.embedding.api-key=test-only-embedding-key",
        "spring.ai.openai.embedding.options.model=test-embedding"
})
@ActiveProfiles("test")
class AiEnabledApiTest {
    @MockBean ChatModel chatModel;
    @MockBean EmbeddingModel embeddingModel;
    @Autowired TestRestTemplate rest;
    @Autowired JdbcTemplate jdbc;
    @Autowired AiRepository repository;

    @Test
    void createsKnowledgeBaseAndActivatesImmutablePersonaVersion() {
        Long siteId = jdbc.queryForObject("SELECT id FROM sites ORDER BY id LIMIT 1", Long.class);
        String root = "/api/v1/sites/" + siteId + "/ai";
        assertThat(rest.getForObject(root + "/status", Map.class))
                .containsEntry("enabled", true).containsEntry("state", "CONFIGURED_REMOTE");

        var kb = rest.postForEntity(root + "/knowledge-bases", Map.of("name", "Operations"), Map.class);
        assertThat(kb.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(kb.getBody()).containsEntry("name", "Operations");

        var version = rest.exchange(root + "/persona", HttpMethod.PUT,
                new HttpEntity<>(Map.of("name", "Concise", "instructions", "Reply briefly",
                        "expectedVersion", 0)), Map.class);
        assertThat(version.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(version.getBody()).containsEntry("version", 1).containsEntry("active", false);

        var activated = rest.postForEntity(root + "/persona/1/activate", null, Map.class);
        assertThat(activated.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(activated.getBody()).containsEntry("active", true);
        assertThat(rest.getForObject(root + "/persona", Map.class)).containsEntry("version", 1);
    }

    @Test
    void concurrentRequestsCannotExceedChatOrUploadDailyBudget() throws Exception {
        long siteId = isolatedSite();
        Instant dayStart = Instant.now().truncatedTo(ChronoUnit.DAYS);
        var executor = Executors.newFixedThreadPool(8);
        try {
            CountDownLatch chatReady = new CountDownLatch(8);
            CountDownLatch chatStart = new CountDownLatch(1);
            List<Future<Boolean>> chatResults = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                chatResults.add(executor.submit(() -> {
                    chatReady.countDown();
                    chatStart.await();
                    return repository.reserveChatAttempt(siteId, "viewer", 1, dayStart);
                }));
            }
            chatReady.await();
            chatStart.countDown();
            int admitted = 0;
            for (Future<Boolean> result : chatResults) if (result.get()) admitted++;
            assertThat(admitted).isEqualTo(1);
            assertThat(repository.chatCountSince(siteId, dayStart)).isEqualTo(1);

            var kb = repository.createKnowledgeBase(siteId, "Manuals", "owner");
            CountDownLatch uploadReady = new CountDownLatch(8);
            CountDownLatch uploadStart = new CountDownLatch(1);
            List<Future<Boolean>> uploadResults = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                int index = i;
                uploadResults.add(executor.submit(() -> {
                    uploadReady.countDown();
                    uploadStart.await();
                    try {
                        repository.createUpload(siteId, kb.id(), "manual-" + index + ".txt",
                                "text/plain", "YQ==", "hash-" + index, 1, "owner",
                                "test-embedding", 100, 1, dayStart);
                        return true;
                    } catch (AiException exception) {
                        assertThat(exception.getStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
                        return false;
                    }
                }));
            }
            uploadReady.await();
            uploadStart.countDown();
            admitted = 0;
            for (Future<Boolean> result : uploadResults) if (result.get()) admitted++;
            assertThat(admitted).isEqualTo(1);
            assertThat(repository.ingestAttemptCountSince(siteId, dayStart)).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void failedPublicationRollsBackPreviousVisibleVersion() {
        long siteId = isolatedSite();
        var kb = repository.createKnowledgeBase(siteId, "Manuals", "owner");
        var old = repository.createDocument(siteId, kb.id(), "manual.txt", "text/plain",
                "YQ==", "old-hash", 1, "owner");
        repository.documentStatus(siteId, old.documentId(), "PUBLISHED");
        var replacement = repository.createDocument(siteId, kb.id(), "manual.txt", "text/plain",
                "Yg==", "new-hash", 1, "owner");

        assertThatThrownBy(() -> repository.publishDocument(siteId, replacement.documentId(), replacement.id()))
                .hasMessageContaining("lost its pending job");
        assertThat(repository.document(siteId, old.documentId()).status()).isEqualTo("PUBLISHED");
        assertThat(repository.document(siteId, replacement.documentId()).status()).isEqualTo("PENDING");
        assertThat(repository.job(siteId, replacement.id()).status()).isEqualTo("QUEUED");
    }

    private long isolatedSite() {
        Long organizationId = jdbc.queryForObject("SELECT organization_id FROM sites ORDER BY id LIMIT 1", Long.class);
        String code = "ai-" + UUID.randomUUID().toString().substring(0, 12);
        jdbc.update("INSERT INTO sites (organization_id, code, name) VALUES (?, ?, 'AI isolation test')",
                organizationId, code);
        return jdbc.queryForObject("SELECT id FROM sites WHERE code = ?", Long.class, code);
    }
}
