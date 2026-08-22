package com.iot.manager.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.entity.AppUser;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.SiteMembership;
import com.iot.manager.repository.AppUserRepository;
import com.iot.manager.repository.SiteMembershipRepository;
import com.iot.manager.service.BootstrapService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "iot.security.enabled=true",
                "iot.web.allowed-origins[0]=https://iot.example.test"
        }
)
@ActiveProfiles("test")
@Import(AgentCredentialControllerSecurityTest.JwtDecoderConfiguration.class)
class AgentCredentialControllerSecurityTest {

    @LocalServerPort
    private int port;

    @Autowired
    private BootstrapService bootstrapService;

    @Autowired
    private AppUserRepository appUserRepository;

    @Autowired
    private SiteMembershipRepository siteMembershipRepository;

    @Autowired
    private ObjectMapper objectMapper;

    private final TestRestTemplate restTemplate = new TestRestTemplate();

    @BeforeEach
    void ensureAdminMembership() {
        Site site = bootstrapService.ensureDemoContext().getSite();
        AppUser admin = appUserRepository.findBySubjectAndEnabledTrue("credential-api-admin")
                .orElseGet(() -> appUserRepository.save(AppUser.builder()
                        .subject("credential-api-admin")
                        .username("credential-api-admin")
                        .build()));
        if (!siteMembershipRepository.existsByUserIdAndSiteId(admin.getId(), site.getId())) {
            siteMembershipRepository.save(SiteMembership.builder().user(admin).site(site).build());
        }
    }

    @Test
    void adminReceivesSecretOnceAndViewerCannotProvision() throws Exception {
        String agentId = "api-agent-" + UUID.randomUUID();
        String requestJson = objectMapper.writeValueAsString(Map.of(
                "agentId", agentId,
                "siteCode", "demo-site",
                "agentName", "API provisioned agent",
                "reason", "initial install"
        ));
        ResponseEntity<String> created = restTemplate.exchange(
                url("/api/v1/edge-agents/credentials"),
                HttpMethod.POST,
                new HttpEntity<>(requestJson, bearer("admin-token")),
                String.class
        );

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        JsonNode payload = objectMapper.readTree(created.getBody());
        String credentialId = payload.path("credentialId").asText();
        String token = payload.path("token").asText();
        assertThat(credentialId).isNotBlank();
        assertThat(token).startsWith("iat_");

        ResponseEntity<String> listed = restTemplate.exchange(
                url("/api/v1/edge-agents/" + agentId + "/credentials"),
                HttpMethod.GET,
                new HttpEntity<>(bearer("admin-token")),
                String.class
        );
        assertThat(listed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(listed.getBody()).doesNotContain(token);

        ResponseEntity<String> viewer = restTemplate.exchange(
                url("/api/v1/edge-agents/credentials"),
                HttpMethod.POST,
                new HttpEntity<>(requestJson, bearer("viewer-token")),
                String.class
        );
        assertThat(viewer.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    private HttpHeaders bearer(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
        return headers;
    }

    private String url(String path) {
        return "http://localhost:" + port + path;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class JwtDecoderConfiguration {
        @Bean
        JwtDecoder jwtDecoder() {
            return token -> {
                boolean admin = "admin-token".equals(token);
                return Jwt.withTokenValue(token)
                        .header("alg", "none")
                        .subject(admin ? "credential-api-admin" : "credential-api-viewer")
                        .issuedAt(Instant.now().minusSeconds(5))
                        .expiresAt(Instant.now().plusSeconds(300))
                        .claim("preferred_username", admin ? "admin" : "viewer")
                        .claim("realm_access", Map.of("roles", List.of(admin ? "ADMIN" : "VIEWER")))
                        .build();
            };
        }
    }
}
