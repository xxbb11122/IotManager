package com.iot.manager.ai;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.reactive.function.client.WebClient;

@Configuration
public class AiHttpTimeoutConfig {
    // Own the chat API client so provider timeouts never change weather or
    // other Spring Boot RestClient builders in the application.
    @Bean
    @ConditionalOnProperty(prefix = "iot.ai", name = "enabled", havingValue = "true")
    OpenAiApi aiChatApi(@Value("${spring.ai.openai.chat.base-url:}") String baseUrl,
                       @Value("${spring.ai.openai.chat.api-key:}") String apiKey,
                       @Value("${iot.ai.chat-completions-path:/chat/completions}") String completionsPath) {
        if (completionsPath == null || !completionsPath.matches("/[A-Za-z0-9/_-]+")
                || completionsPath.contains("//") || completionsPath.contains("..")) {
            throw new IllegalStateException("AI chat completions path is invalid");
        }
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5_000);
        factory.setReadTimeout(30_000);
        return OpenAiApi.builder()
                .baseUrl(baseUrl)
                .apiKey(apiKey)
                .completionsPath(completionsPath)
                .responseErrorHandler(new AiProviderErrorHandler())
                .restClientBuilder(RestClient.builder().requestFactory(factory))
                .webClientBuilder(WebClient.builder())
                .build();
    }
}
