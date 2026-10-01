package com.iot.manager.ai;

import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "iot.ai.enabled=true",
        "iot.ai.knowledge-enabled=false",
        "iot.ai.allowed-hosts[0]=api.deepseek.com",
        "spring.ai.model.chat=openai",
        "spring.ai.model.embedding=none",
        "spring.ai.openai.chat.base-url=https://api.deepseek.com",
        "spring.ai.openai.chat.api-key=test-only-chat-key",
        "spring.ai.openai.chat.options.model=deepseek-flash"
})
@ActiveProfiles("test")
class AiChatOnlyConfigurationTest {
    @Autowired ApplicationContext context;
    @Autowired AiModelGateway gateway;
    @Autowired TestRestTemplate rest;
    @Autowired JdbcTemplate jdbc;

    @Test
    void startsWithChatModelAndNoEmbeddingCredential() {
        assertThat(context.getBeansOfType(ChatModel.class)).isNotEmpty();
        assertThat(context.getBeansOfType(EmbeddingModel.class)).isEmpty();
        assertThat(gateway.embeddingModelName()).isBlank();
    }

    @Test
    void exposesChatAndPersonaWhileKnowledgeEndpointsStayClosed() {
        long siteId = jdbc.queryForObject("SELECT id FROM sites ORDER BY id LIMIT 1", Long.class);
        String root = "/api/v1/sites/" + siteId + "/ai";
        assertThat(rest.getForObject(root + "/status", Map.class))
                .containsEntry("enabled", true).containsEntry("knowledgeEnabled", false);
        assertThat(rest.getForEntity(root + "/knowledge-bases", String.class).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(rest.getForEntity(root + "/persona/versions", String.class).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }
}
