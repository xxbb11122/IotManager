package com.iot.manager.ai;

import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientResponseException;

import java.net.URI;
import java.net.SocketTimeoutException;
import java.util.List;
import java.util.Locale;

@Component
@ConditionalOnProperty(prefix = "iot.ai", name = "enabled", havingValue = "true")
public class AiModelGateway {
    public record VectorResult(float[] vector, Integer inputTokens) { }
    public record Answer(String text, String model, Integer inputTokens, Integer outputTokens) { }
    private final ChatModel chatModel;
    private final EmbeddingModel embeddingModel;
    private final AiProperties properties;
    private final String embeddingModelName;

    public AiModelGateway(
            ChatModel chatModel,
            ObjectProvider<EmbeddingModel> embeddingModels,
            AiProperties properties,
            @Value("${spring.ai.openai.chat.base-url:}") String chatUrl,
            @Value("${spring.ai.openai.embedding.base-url:}") String embeddingUrl,
            @Value("${spring.ai.openai.chat.api-key:}") String chatKey,
            @Value("${spring.ai.openai.embedding.api-key:}") String embeddingKey,
            @Value("${spring.ai.openai.embedding.options.model:}") String embeddingModelName
    ) {
        this.chatModel = chatModel;
        this.embeddingModel = embeddingModels.getIfAvailable();
        this.properties = properties;
        this.embeddingModelName = embeddingModelName;
        if (properties.getEmbeddingDimension() < 1 || properties.getEmbeddingDimension() > 2000
                || properties.getMaxConcurrentChats() < 1 || properties.getConversationRetentionDays() < 1
                || properties.getMaxQuestionChars() < 1 || properties.getMaxAnswerChars() < 1
                || properties.getMaxInputChars() < 1
                || properties.getRequestTimeoutSeconds() < (properties.isKnowledgeEnabled() ? 90 : 40)
                || properties.getRequestTimeoutSeconds() > 600
                || properties.getMaxFileBytes() < 1 || properties.getMaxSiteBytes() < properties.getMaxFileBytes()
                || properties.getMaxSiteChatsPerDay() < 1 || properties.getMaxSiteUploadsPerDay() < 1
                || !Double.isFinite(properties.getMinSimilarity())
                || properties.getMinSimilarity() < 0 || properties.getMinSimilarity() > 1) {
            throw new IllegalStateException("AI capacity and model configuration is invalid");
        }
        validateEndpoint(chatUrl, properties.getAllowedHosts());
        if (chatKey.isBlank()) {
            throw new IllegalStateException("Enabled AI requires a remote chat credential");
        }
        if (properties.isKnowledgeEnabled()) {
            validateEndpoint(embeddingUrl, properties.getAllowedHosts());
            if (embeddingKey.isBlank() || embeddingModelName.isBlank() || embeddingModel == null) {
                throw new IllegalStateException("Enabled knowledge base requires a remote embedding model and credential");
            }
        }
    }

    public String embeddingModelName() { return embeddingModelName; }

    public VectorResult embed(String text) {
        if (!properties.isKnowledgeEnabled() || embeddingModel == null) {
            throw new AiException(HttpStatus.SERVICE_UNAVAILABLE, "Knowledge base is disabled");
        }
        try {
            var response = embeddingModel.embedForResponse(List.of(text));
            float[] vector = response.getResult().getOutput();
            if (vector == null || vector.length != properties.getEmbeddingDimension()) {
                throw new AiException(HttpStatus.BAD_GATEWAY, "Embedding dimension differs from configured index");
            }
            for (float value : vector) {
                if (!Float.isFinite(value)) throw new AiException(HttpStatus.BAD_GATEWAY, "Embedding contains invalid values");
            }
            var usage = response.getMetadata() == null ? null : response.getMetadata().getUsage();
            return new VectorResult(vector, usage == null ? null : usage.getPromptTokens());
        } catch (AiException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw providerFailure(exception);
        }
    }

    public Answer answer(String systemPrompt, String question) {
        try {
            var response = chatModel.call(new Prompt(List.of(new SystemMessage(systemPrompt), new UserMessage(question))));
            String text = response.getResult().getOutput().getText();
            if (text == null || text.isBlank()) throw new AiException(HttpStatus.BAD_GATEWAY, "AI provider returned an empty answer");
            var metadata = response.getMetadata();
            var usage = metadata == null ? null : metadata.getUsage();
            String bounded = text.length() > properties.getMaxAnswerChars()
                    ? text.substring(0, properties.getMaxAnswerChars()) : text;
            return new Answer(bounded, metadata == null ? "configured-chat-model" : metadata.getModel(),
                    usage == null ? null : usage.getPromptTokens(),
                    usage == null ? null : usage.getCompletionTokens());
        } catch (AiException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw providerFailure(exception);
        }
    }

    private static void validateEndpoint(String value, List<String> allowedHosts) {
        URI uri;
        try {
            uri = URI.create(value);
        } catch (RuntimeException exception) {
            throw new IllegalStateException("AI model endpoint is invalid");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)
                || allowedHosts == null || allowedHosts.stream().noneMatch(host -> host.trim().equalsIgnoreCase(uri.getHost()))) {
            throw new IllegalStateException("AI model endpoint must be HTTPS and use an allowed host");
        }
    }

    private static AiException providerFailure(RuntimeException exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof AiException ai) return ai;
            if (cause instanceof SocketTimeoutException
                    || cause.getClass().getSimpleName().toLowerCase(Locale.ROOT).contains("timeout")) {
                return new AiException(HttpStatus.GATEWAY_TIMEOUT, "AI provider timed out");
            }
            if (cause instanceof RestClientResponseException response) {
                if (response.getStatusCode().value() == 429) {
                    return new AiException(HttpStatus.SERVICE_UNAVAILABLE, "AI provider is temporarily rate limited", 30);
                }
                if (response.getStatusCode().value() == 503) {
                    return new AiException(HttpStatus.SERVICE_UNAVAILABLE, "AI provider is temporarily unavailable", 30);
                }
            }
        }
        return new AiException(HttpStatus.BAD_GATEWAY, "AI provider request failed");
    }
}
