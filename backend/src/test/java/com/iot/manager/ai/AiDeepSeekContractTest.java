package com.iot.manager.ai;

import org.junit.jupiter.api.Test;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.http.HttpMethod.POST;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AiDeepSeekContractTest {
    @Test
    void sendsOpenAiCompatibleChatRequestToDeepSeekWithoutEmbedding() {
        RestClient.Builder restBuilder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restBuilder).build();
        server.expect(once(), requestTo("https://api.deepseek.com/chat/completions"))
                .andExpect(method(POST))
                .andExpect(header("Authorization", "Bearer test-only-key"))
                .andExpect(jsonPath("$.model").value("deepseek-flash"))
                .andExpect(jsonPath("$.messages[0].role").value("system"))
                .andExpect(jsonPath("$.messages[1].role").value("user"))
                .andRespond(withSuccess("""
                        {"id":"test-chat","object":"chat.completion","created":1,
                         "model":"deepseek-flash","choices":[{"index":0,
                         "message":{"role":"assistant","content":"模拟回答"},"finish_reason":"stop"}],
                         "usage":{"prompt_tokens":8,"completion_tokens":4,"total_tokens":12}}
                        """, MediaType.APPLICATION_JSON));
        AiModelGateway gateway = gateway(restBuilder);

        var answer = gateway.answer("Only system rules", "Question and untrusted evidence");

        assertThat(answer.text()).isEqualTo("模拟回答");
        assertThat(answer.model()).isEqualTo("deepseek-flash");
        assertThat(answer.inputTokens()).isEqualTo(8);
        assertThat(answer.outputTokens()).isEqualTo(4);
        server.verify();
    }

    @Test
    void mapsProviderErrorsWithoutExposingCredentialOrProviderBody() {
        for (HttpStatus upstream : List.of(HttpStatus.TOO_MANY_REQUESTS,
                HttpStatus.SERVICE_UNAVAILABLE, HttpStatus.UNAUTHORIZED)) {
            RestClient.Builder restBuilder = RestClient.builder();
            MockRestServiceServer server = MockRestServiceServer.bindTo(restBuilder).build();
            server.expect(once(), requestTo("https://api.deepseek.com/chat/completions"))
                    .andRespond(withStatus(upstream)
                            .contentType(MediaType.APPLICATION_JSON)
                            .body("{\"error\":{\"message\":\"provider private detail\"}}"));
            AiModelGateway gateway = gateway(restBuilder);

            assertThatThrownBy(() -> gateway.answer("system", "question"))
                    .isInstanceOfSatisfying(AiException.class, exception -> {
                        assertThat(exception.getStatus()).isEqualTo(upstream == HttpStatus.UNAUTHORIZED
                                ? HttpStatus.BAD_GATEWAY : HttpStatus.SERVICE_UNAVAILABLE);
                        assertThat(exception.getRetryAfterSeconds()).isEqualTo(
                                upstream == HttpStatus.UNAUTHORIZED ? 0 : 30);
                        assertThat(exception.getMessage()).doesNotContain("test-only-key", "provider private detail");
                    });
            server.verify();
        }
    }

    private static AiModelGateway gateway(RestClient.Builder restBuilder) {
        OpenAiApi api = OpenAiApi.builder().baseUrl("https://api.deepseek.com")
                .apiKey("test-only-key").completionsPath("/chat/completions")
                .responseErrorHandler(new AiProviderErrorHandler())
                .restClientBuilder(restBuilder).build();
        var chatModel = OpenAiChatModel.builder().openAiApi(api)
                .defaultOptions(OpenAiChatOptions.builder().model("deepseek-flash").maxTokens(128).build())
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
}
