package com.iot.manager.ai;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.when;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "iot.security.enabled=true",
        "iot.web.allowed-origins[0]=https://iot.example.test",
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
@Import(AiSecurityIntegrationTest.DecoderConfig.class)
class AiSecurityIntegrationTest {
    @MockBean org.springframework.ai.chat.model.ChatModel chatModel;
    @MockBean org.springframework.ai.embedding.EmbeddingModel embeddingModel;
    @MockBean AiChatService chatService;
    @Autowired TestRestTemplate rest;
    @Autowired JdbcTemplate jdbc;

    @Test
    void viewerCanAskOnlyAtMemberSiteAndCannotManageKnowledge() {
        jdbc.update("INSERT INTO organizations (code, name) VALUES ('ai-security-org', 'AI security')");
        Long organization = jdbc.queryForObject(
                "SELECT id FROM organizations WHERE code = 'ai-security-org'", Long.class);
        jdbc.update("INSERT INTO sites (organization_id, code, name) VALUES (?, 'member', 'Member')", organization);
        jdbc.update("INSERT INTO sites (organization_id, code, name) VALUES (?, 'foreign', 'Foreign')", organization);
        long member = jdbc.queryForObject("SELECT id FROM sites WHERE code = 'member'", Long.class);
        long foreign = jdbc.queryForObject("SELECT id FROM sites WHERE code = 'foreign'", Long.class);
        jdbc.update("INSERT INTO app_users (subject, username, enabled) VALUES ('ai-viewer', 'ai-viewer', true)");
        jdbc.update("INSERT INTO app_users (subject, username, enabled) VALUES ('ai-admin', 'ai-admin', true)");
        Long viewerId = jdbc.queryForObject("SELECT id FROM app_users WHERE subject = 'ai-viewer'", Long.class);
        Long adminId = jdbc.queryForObject("SELECT id FROM app_users WHERE subject = 'ai-admin'", Long.class);
        jdbc.update("INSERT INTO site_memberships (user_id, site_id) VALUES (?, ?)", viewerId, member);
        jdbc.update("INSERT INTO site_memberships (user_id, site_id) VALUES (?, ?)", adminId, member);
        when(chatService.chat(eq(member), eq("ai-viewer"), eq("question"), nullable(String.class)))
                .thenReturn(new AiChatService.Reply("request", "conversation", "answer", List.of()));

        String memberRoot = "/api/v1/sites/" + member + "/ai";
        var allowed = rest.exchange(memberRoot + "/chat", HttpMethod.POST,
                new HttpEntity<>(Map.of("question", "question"), bearer("viewer-token")), Map.class);
        var forbiddenWrite = rest.exchange(memberRoot + "/knowledge-bases", HttpMethod.POST,
                new HttpEntity<>(Map.of("name", "Not allowed"), bearer("viewer-token")), Map.class);
        var foreignChat = rest.exchange("/api/v1/sites/" + foreign + "/ai/chat", HttpMethod.POST,
                new HttpEntity<>(Map.of("question", "question"), bearer("viewer-token")), Map.class);
        var foreignStatus = rest.exchange("/api/v1/sites/" + foreign + "/ai/status", HttpMethod.GET,
                new HttpEntity<>(bearer("viewer-token")), Map.class);
        var memberStatus = rest.exchange(memberRoot + "/status", HttpMethod.GET,
                new HttpEntity<>(bearer("viewer-token")), Map.class);
        var draftList = rest.exchange(memberRoot + "/knowledge-bases/example/documents", HttpMethod.GET,
                new HttpEntity<>(bearer("viewer-token")), Map.class);
        var adminWrite = rest.exchange(memberRoot + "/knowledge-bases", HttpMethod.POST,
                new HttpEntity<>(Map.of("name", "Allowed"), bearer("admin-token")), Map.class);

        assertThat(allowed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(allowed.getBody()).containsEntry("answer", "answer");
        assertThat(forbiddenWrite.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(foreignChat.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(foreignStatus.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(memberStatus.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(draftList.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(adminWrite.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    }

    private static HttpHeaders bearer(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return headers;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class DecoderConfig {
        @Bean JwtDecoder jwtDecoder() {
            return token -> {
                boolean admin = "admin-token".equals(token);
                return Jwt.withTokenValue(token).header("alg", "none")
                        .subject(admin ? "ai-admin" : "ai-viewer")
                        .issuedAt(Instant.now().minusSeconds(5))
                        .expiresAt(Instant.now().plusSeconds(300))
                        .claim("realm_access", Map.of("roles", List.of(admin ? "ADMIN" : "VIEWER")))
                        .build();
            };
        }
    }
}
