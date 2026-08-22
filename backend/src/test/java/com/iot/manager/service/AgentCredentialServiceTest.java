package com.iot.manager.service;

import com.iot.manager.dto.AgentCredentialProvisionRequest;
import com.iot.manager.dto.AgentCredentialRotateRequest;
import com.iot.manager.entity.AgentCredential;
import com.iot.manager.entity.Site;
import com.iot.manager.repository.AgentCredentialRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDateTime;
import java.util.NoSuchElementException;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("test")
class AgentCredentialServiceTest {

    @Autowired
    private AgentCredentialService credentialService;

    @Autowired
    private AgentCredentialRepository credentialRepository;

    @Autowired
    private BootstrapService bootstrapService;

    @Test
    void provisionsHashAuthenticatesRotatesAndRevokesWithoutReturningTheHash() {
        Site site = bootstrapService.ensureDemoContext().getSite();
        String agentId = "credential-test-" + UUID.randomUUID();

        var issued = credentialService.provision(site, new AgentCredentialProvisionRequest(
                agentId,
                site.getCode(),
                "Credential test agent",
                LocalDateTime.now().plusDays(7),
                "initial test provision"
        ), "test-operator");

        assertThat(issued.token()).startsWith("iat_");
        assertThat(issued.token()).doesNotContain(issued.credentialId());
        AgentCredential stored = credentialRepository.findByCredentialId(issued.credentialId()).orElseThrow();
        assertThat(stored.getTokenHash()).doesNotContain(issued.token());
        assertThat(stored.getStatus()).isEqualTo(AgentCredentialService.ACTIVE);

        var authenticated = credentialService.authenticate(issued.credentialId(), issued.token());
        assertThat(authenticated.agentId()).isEqualTo(agentId);
        assertThat(authenticated.siteId()).isEqualTo(site.getId());
        assertThat(credentialRepository.findByCredentialId(issued.credentialId()).orElseThrow().getLastUsedAt())
                .isNotNull();

        var rotated = credentialService.rotate(agentId, new AgentCredentialRotateRequest(
                LocalDateTime.now().plusDays(3), "scheduled rotation"
        ), "test-operator");
        assertThat(credentialRepository.findByCredentialId(issued.credentialId()).orElseThrow().getStatus())
                .isEqualTo(AgentCredentialService.REVOKED);
        assertThat(credentialService.authenticate(rotated.credentialId(), rotated.token()).agentId())
                .isEqualTo(agentId);
        assertThatThrownBy(() -> credentialService.authenticate(issued.credentialId(), issued.token()))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);

        var revoked = credentialService.revoke(agentId, rotated.credentialId(), "test-operator", "test complete");
        assertThat(revoked.status()).isEqualTo(AgentCredentialService.REVOKED);
        assertThat(credentialService.isActive(rotated.credentialId())).isFalse();
    }

    @Test
    void rejectsExpiredAndOverlongCredentials() {
        Site site = bootstrapService.ensureDemoContext().getSite();
        String agentId = "credential-expiry-" + UUID.randomUUID();

        assertThatThrownBy(() -> credentialService.provision(site, new AgentCredentialProvisionRequest(
                agentId, site.getCode(), "Expiry test agent", LocalDateTime.now().minusMinutes(1), null
        ), "test-operator")).isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> credentialService.provision(site, new AgentCredentialProvisionRequest(
                agentId, site.getCode(), "Expiry test agent", LocalDateTime.now().plusDays(91), null
        ), "test-operator")).isInstanceOf(IllegalArgumentException.class);
    }
}
