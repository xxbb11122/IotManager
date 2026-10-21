package com.iot.manager.ai;

import org.junit.jupiter.api.Test;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import com.sun.net.httpserver.HttpServer;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import tools.jackson.databind.ObjectMapper;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AiDeepSeekContractTest {
    @Test
    void sendsOpenAiCompatibleChatRequestToDeepSeekWithoutEmbedding() throws Exception {
        try (var server = new Provider(200, """
                        {"id":"test-chat","object":"chat.completion","created":1,
                         "model":"deepseek-flash","choices":[{"index":0,
                         "message":{"role":"assistant","content":"模拟回答"},"finish_reason":"stop"}],
                         "usage":{"prompt_tokens":8,"completion_tokens":4,"total_tokens":12}}
                        """)) {
        AiModelGateway gateway = gateway(server, "/chat/completions");

        var answer = gateway.answer("Only system rules", "Question and untrusted evidence");

        assertThat(answer.text()).isEqualTo("模拟回答");
        assertThat(answer.model()).isEqualTo("deepseek-flash");
        assertThat(answer.inputTokens()).isEqualTo(8);
        assertThat(answer.outputTokens()).isEqualTo(4);
        assertThat(server.calls.get()).isEqualTo(1);
        assertThat(server.path.get()).isEqualTo("/chat/completions");
        assertThat(server.method.get()).isEqualTo("POST");
        assertThat(server.authorization.get()).isEqualTo("Bearer test-only-key");
        var body = new ObjectMapper().readTree(server.body.get());
        assertThat(body.path("model").asString()).isEqualTo("deepseek-flash");
        assertThat(body.path("messages").get(0).path("role").asString()).isEqualTo("system");
        assertThat(body.path("messages").get(1).path("role").asString()).isEqualTo("user");
        }
    }

    @Test
    void mapsProviderErrorsWithoutExposingCredentialOrProviderBody() throws Exception {
        for (HttpStatus upstream : List.of(HttpStatus.TOO_MANY_REQUESTS,
                HttpStatus.SERVICE_UNAVAILABLE, HttpStatus.UNAUTHORIZED)) {
            try (var server = new Provider(upstream.value(),
                    "{\"error\":{\"message\":\"provider private detail\"}}")) {
            AiModelGateway gateway = gateway(server, "/chat/completions");

            assertThatThrownBy(() -> gateway.answer("system", "question"))
                    .isInstanceOfSatisfying(AiException.class, exception -> {
                        assertThat(exception.getStatus()).isEqualTo(upstream == HttpStatus.UNAUTHORIZED
                                ? HttpStatus.BAD_GATEWAY : HttpStatus.SERVICE_UNAVAILABLE);
                        assertThat(exception.getRetryAfterSeconds()).isEqualTo(
                                upstream == HttpStatus.UNAUTHORIZED ? 0 : 30);
                        assertThat(exception.getMessage()).doesNotContain("test-only-key", "provider private detail");
                    });
            // The SDK must not retry side-effecting model requests behind
            // the application's request deadline and accounting controls.
            assertThat(server.calls.get()).isEqualTo(1);
            }
        }
    }

    @Test
    void preservesConfiguredProviderPath() throws Exception {
        try (var server = new Provider(401, "{}")) {
            assertThatThrownBy(() -> gateway(server, "/compatible/chat").answer("system", "question"))
                    .isInstanceOf(AiException.class);
            assertThat(server.path.get()).isEqualTo("/compatible/chat");
            assertThat(server.calls.get()).isEqualTo(1);
        }
    }

    @Test
    void refusesUnsafeProviderPathsBeforeCreatingTransport() {
        for (String path : List.of("//external.test/chat", "/../chat", "/chat?token=secret", "https://external.test/chat")) {
            assertThatThrownBy(() -> new AiHttpTimeoutConfig().aiTransport(path))
                    .isInstanceOf(IllegalStateException.class);
        }
    }

    @Test
    void sdkRequestDeadlineMapsToGatewayTimeoutWithoutRetry() throws Exception {
        try (var server = new Provider(200, "{}", 800)) {
            var gateway = gateway(server, "/chat/completions", Duration.ofMillis(200));
            assertThatThrownBy(() -> gateway.answer("system", "question"))
                    .isInstanceOfSatisfying(AiException.class, error -> {
                        assertThat(error.getStatus()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);
                        assertThat(error.getMessage()).isEqualTo("AI provider timed out");
                    });
            assertThat(server.calls.get()).isEqualTo(1);
        }
    }

    private static AiModelGateway gateway(Provider server, String path) {
        return gateway(server, path, Duration.ofSeconds(30));
    }

    private static AiModelGateway gateway(Provider server, String path, Duration timeout) {
        // The real SDK transport talks only to this loopback fixture. The
        // gateway retains the production HTTPS/allowlist validation contract.
        var chatModel = OpenAiChatModel.builder()
                .options(OpenAiChatOptions.builder().baseUrl(server.url())
                        .apiKey("test-only-key").model("deepseek-flash").maxTokens(128)
                        .maxRetries(0).timeout(timeout).build())
                .httpClientBuilderCustomizers(List.of(new AiHttpTimeoutConfig().aiTransport(path),
                        builder -> builder.timeout(timeout)))
                .build();
        @SuppressWarnings("unchecked")
        ObjectProvider<EmbeddingModel> noEmbedding = mock(ObjectProvider.class);
        when(noEmbedding.getIfAvailable()).thenReturn(null);
        AiProperties properties = new AiProperties();
        properties.setEnabled(true);
        properties.setAllowedHosts(List.of("api.deepseek.com"));
        return new AiModelGateway(chatModel, noEmbedding, properties,
                "https://api.deepseek.com", "", "test-only-key", "", "");
    }

    private static final class Provider implements AutoCloseable {
        final HttpServer server;
        final AtomicInteger calls = new AtomicInteger();
        final AtomicReference<String> path = new AtomicReference<>();
        final AtomicReference<String> method = new AtomicReference<>();
        final AtomicReference<String> authorization = new AtomicReference<>();
        final AtomicReference<String> body = new AtomicReference<>();

        Provider(int status, String response) throws Exception {
            this(status, response, 0);
        }

        Provider(int status, String response, long delayMillis) throws Exception {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                calls.incrementAndGet();
                path.set(exchange.getRequestURI().getPath());
                method.set(exchange.getRequestMethod());
                authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
                body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                try { Thread.sleep(delayMillis); }
                catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new java.io.IOException("Fixture interrupted", interrupted);
                }
                byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(status, bytes.length);
                try (var output = exchange.getResponseBody()) { output.write(bytes); }
            });
            server.start();
        }

        String url() { return "http://127.0.0.1:" + server.getAddress().getPort(); }
        public void close() { server.stop(0); }
    }
}
