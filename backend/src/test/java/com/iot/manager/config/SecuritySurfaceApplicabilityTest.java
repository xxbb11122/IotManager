package com.iot.manager.config;

import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.servlet.view.xslt.XsltView;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Applicability evidence, not a vulnerability waiver or a production approval. */
@SpringBootTest(properties = {
        "iot.ai.enabled=true", "iot.ai.knowledge-enabled=true",
        "iot.ai.allowed-hosts[0]=example.test",
        "spring.ai.model.chat=openai", "spring.ai.model.embedding=openai",
        "spring.ai.openai.chat.base-url=https://example.test",
        "spring.ai.openai.embedding.base-url=https://example.test",
        "spring.ai.openai.chat.api-key=test-only", "spring.ai.openai.embedding.api-key=test-only",
        "spring.ai.openai.chat.model=test-chat", "spring.ai.openai.embedding.model=test-embedding"
})
@ActiveProfiles("test")
@AutoConfigureMockMvc
class SecuritySurfaceApplicabilityTest {
    @Autowired ApplicationContext context;
    @Autowired RequestMappingHandlerMapping requestMappingHandlerMapping;
    @Autowired MockMvc mvc;

    @Test
    void actualApplicationHandlersReturnBodiesWithoutSseViewFragments() {
        var handlers = requestMappingHandlerMapping.getHandlerMethods().entrySet().stream()
                .filter(entry -> entry.getValue().getBeanType().getPackageName().startsWith("com.iot.manager"))
                .toList();
        assertThat(handlers).hasSizeGreaterThan(40);
        for (var entry : handlers) {
            var method = entry.getValue();
            assertThat(AnnotatedElementUtils.hasAnnotation(method.getBeanType(), ResponseBody.class)
                    || method.hasMethodAnnotation(ResponseBody.class)).as(method.toString()).isTrue();
            assertThat(SseEmitter.class.isAssignableFrom(method.getReturnType().getParameterType())).isFalse();
            assertThat(method.getReturnType().getParameterType().getName()).doesNotContain("FragmentsRendering");
            assertThat(entry.getKey().getProducesCondition().getProducibleMediaTypes())
                    .doesNotContain(MediaType.TEXT_EVENT_STREAM);
        }
        assertThat(context.getBeansOfType(XsltView.class)).isEmpty();
    }

    @Test
    void noFunctionalRouterOrMcpServerIsRegisteredEvenWithAiEnabled() throws Exception {
        for (String type : new String[]{
                "org.springframework.web.servlet.function.RouterFunction",
                "org.springframework.web.reactive.function.server.RouterFunction",
                "io.modelcontextprotocol.server.McpSyncServer",
                "io.modelcontextprotocol.server.McpAsyncServer"}) {
            try {
                assertThat(context.getBeanNamesForType(Class.forName(type))).as(type).isEmpty();
            } catch (ClassNotFoundException absent) {
                // An absent optional transport cannot register a route.
            }
        }
        assertThat(Arrays.stream(context.getBeanDefinitionNames()).map(context::getType)
                .filter(type -> type != null).map(Class::getName))
                .noneMatch(name -> name.startsWith("io.modelcontextprotocol.server."));
    }

    @Test
    void hostileOriginCannotReachAnMcpOrSseEndpoint() throws Exception {
        for (String path : new String[]{"/mcp", "/sse", "/api/v1/mcp", "/api/v1/sse"}) {
            mvc.perform(get(path).header("Origin", "https://untrusted.example.test")
                    .accept(MediaType.TEXT_EVENT_STREAM)).andExpect(status().isNotFound());
            mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(status().isNotFound());
        }
    }

    @Test
    void representativeDiagnosticApiNegotiatesJsonAndRejectsSse() throws Exception {
        mvc.perform(get("/api/v1/time").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON));
        mvc.perform(get("/api/v1/time").accept(MediaType.TEXT_EVENT_STREAM))
                .andExpect(status().isNotAcceptable());
    }
}
