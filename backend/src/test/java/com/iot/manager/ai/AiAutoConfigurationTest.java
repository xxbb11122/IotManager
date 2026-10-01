package com.iot.manager.ai;

import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = {
        "iot.ai.enabled=true",
        "iot.ai.knowledge-enabled=true",
        "iot.ai.allowed-hosts[0]=example.test",
        "spring.ai.model.chat=openai",
        "spring.ai.model.embedding=openai",
        "spring.ai.openai.chat.base-url=https://example.test",
        "spring.ai.openai.embedding.base-url=https://example.test",
        "spring.ai.openai.chat.api-key=test-only-chat-key",
        "spring.ai.openai.embedding.api-key=test-only-embedding-key",
        "spring.ai.openai.chat.options.model=test-chat",
        "spring.ai.openai.embedding.options.model=test-embedding"
})
@ActiveProfiles("test")
class AiAutoConfigurationTest {
    @Autowired ChatModel chatModel;
    @Autowired EmbeddingModel embeddingModel;
    @Autowired AiModelGateway gateway;

    @Test
    void createsRemoteSpringAiModelsWithoutConnectingDuringStartup() {
        assertThat(chatModel).isNotNull();
        assertThat(embeddingModel).isNotNull();
        assertThat(gateway.embeddingModelName()).isEqualTo("test-embedding");
    }
}
