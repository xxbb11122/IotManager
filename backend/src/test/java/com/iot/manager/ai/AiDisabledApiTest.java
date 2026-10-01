package com.iot.manager.ai;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class AiDisabledApiTest {
    @Autowired TestRestTemplate rest;
    @Autowired JdbcTemplate jdbc;

    @Test
    void disabledAiReportsItsStateWithoutAffectingHealth() {
        Long siteId = jdbc.queryForObject("SELECT id FROM sites ORDER BY id LIMIT 1", Long.class);
        String root = "/api/v1/sites/" + siteId + "/ai";

        assertThat(rest.getForObject(root + "/status", Map.class))
                .containsEntry("enabled", false).containsEntry("state", "DISABLED").hasSize(3);
        Map capabilities = rest.getForObject(root + "/capabilities", Map.class);
        assertThat(capabilities).containsEntry("contractVersion", 1);
        assertThat((Map) capabilities.get("features")).containsEntry("requestRecovery", false)
                .containsEntry("history", false).containsEntry("personaActivationGuard", false);
        assertThat(rest.postForEntity(root + "/chat", Map.of("question", "hello"), String.class)
                .getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(rest.getForEntity("/actuator/health/readiness", String.class)
                .getStatusCode()).isEqualTo(HttpStatus.OK);
    }
}
