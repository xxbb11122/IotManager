package com.iot.manager.service;

import com.iot.manager.dto.AgentCredentialProvisionRequest;
import com.iot.manager.dto.AgentCredentialRotateRequest;
import com.iot.manager.dto.AgentCredentialView;
import com.iot.manager.dto.IssuedAgentCredentialView;
import com.iot.manager.entity.AgentCredential;
import com.iot.manager.entity.AgentCredentialRotation;
import com.iot.manager.entity.EdgeAgent;
import com.iot.manager.entity.Site;
import com.iot.manager.repository.AgentCredentialRepository;
import com.iot.manager.repository.AgentCredentialRotationRepository;
import com.iot.manager.repository.EdgeAgentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;

/**
 * Issues and validates per-agent credentials. Plaintext values are generated
 * once, returned to the provisioning caller once, then discarded. Only BCrypt
 * digests remain in the database.
 */
@Service
@RequiredArgsConstructor
public class AgentCredentialService {

    public static final String ACTIVE = "ACTIVE";
    public static final String REVOKED = "REVOKED";
    private static final int MAX_LIFETIME_DAYS = 90;

    private final EdgeAgentRepository agentRepository;
    private final AgentCredentialRepository credentialRepository;
    private final AgentCredentialRotationRepository rotationRepository;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final SecureRandom secureRandom = new SecureRandom();

    @Transactional
    public IssuedAgentCredentialView provision(
            Site site,
            AgentCredentialProvisionRequest request,
            String actorSubject
    ) {
        String requestedAgentId = requiredText(request.agentId(), "agentId");
        EdgeAgent agent = agentRepository.findByAgentIdForUpdate(requestedAgentId).orElseGet(() -> EdgeAgent.builder()
                .agentId(requestedAgentId)
                .site(site)
                .status("PROVISIONED")
                .createdAt(LocalDateTime.now())
                .build());
        if (!agent.getSite().getId().equals(site.getId())) {
            throw new IllegalArgumentException("Agent identity is already assigned to a different site");
        }
        LocalDateTime now = LocalDateTime.now();
        agent.setName(requiredText(request.agentName(), "agentName"));
        agent.setUpdatedAt(now);
        if (agent.getStatus() == null || agent.getStatus().isBlank()) {
            agent.setStatus("PROVISIONED");
        }
        agent = agentRepository.save(agent);
        return issue(agent, request.expiresAt(), actorSubject, request.reason());
    }

    @Transactional
    public IssuedAgentCredentialView rotate(
            String agentId,
            AgentCredentialRotateRequest request,
            String actorSubject
    ) {
        EdgeAgent agent = requireAgentForUpdate(agentId);
        return issue(agent, request.expiresAt(), actorSubject, request.reason());
    }

    @Transactional
    public AgentCredentialView revoke(
            String agentId,
            String credentialId,
            String actorSubject,
            String reason
    ) {
        EdgeAgent agent = requireAgentForUpdate(agentId);
        AgentCredential credential = credentialRepository.findByCredentialId(requiredText(credentialId, "credentialId"))
                .orElseThrow(() -> new NoSuchElementException("Agent credential not found"));
        if (!credential.getAgent().getId().equals(agent.getId())) {
            throw new NoSuchElementException("Agent credential not found");
        }
        if (ACTIVE.equals(credential.getStatus())) {
            LocalDateTime now = LocalDateTime.now();
            credential.setStatus(REVOKED);
            credential.setRevokedAt(now);
            credential.setUpdatedAt(now);
            credentialRepository.save(credential);
            recordRotation(agent, credential, null, "REVOKED", actorSubject, reason, now);
        }
        return toView(credential);
    }

    @Transactional(readOnly = true)
    public List<AgentCredentialView> list(String agentId) {
        EdgeAgent agent = requireAgent(agentId);
        return credentialRepository.findByAgentIdOrderByCreatedAtDesc(agent.getId()).stream()
                .map(this::toView)
                .toList();
    }

    /**
     * Authenticates only an active, unexpired credential and records its last
     * successful use. Callers receive context values, never a secret or hash.
     */
    @Transactional
    public AuthenticatedAgent authenticate(String credentialId, String token) {
        String normalizedCredentialId = requiredText(credentialId, "credentialId");
        String normalizedToken = requiredText(token, "token");
        AgentCredential credential = credentialRepository.findByCredentialId(normalizedCredentialId)
                .orElseThrow(() -> new AccessDeniedException("Invalid edge agent credential"));
        LocalDateTime now = LocalDateTime.now();
        if (!ACTIVE.equals(credential.getStatus())
                || !credential.getExpiresAt().isAfter(now)
                || !passwordEncoder.matches(normalizedToken, credential.getTokenHash())) {
            throw new AccessDeniedException("Invalid edge agent credential");
        }
        credential.setLastUsedAt(now);
        credential.setUpdatedAt(now);
        credentialRepository.save(credential);
        EdgeAgent agent = credential.getAgent();
        Site site = agent.getSite();
        return new AuthenticatedAgent(agent.getId(), agent.getAgentId(), site.getId(), site.getCode(), credential.getCredentialId());
    }

    @Transactional(readOnly = true)
    public boolean isActive(String credentialId) {
        if (credentialId == null || credentialId.isBlank()) {
            return false;
        }
        return credentialRepository.findByCredentialId(credentialId.trim())
                .filter(credential -> ACTIVE.equals(credential.getStatus()))
                .filter(credential -> credential.getExpiresAt() != null
                        && credential.getExpiresAt().isAfter(LocalDateTime.now()))
                .isPresent();
    }

    @Transactional(readOnly = true)
    public AgentContext context(String agentId) {
        EdgeAgent agent = requireAgent(agentId);
        return new AgentContext(agent.getId(), agent.getAgentId(), agent.getSite().getId(), agent.getSite().getCode());
    }

    private IssuedAgentCredentialView issue(
            EdgeAgent agent,
            LocalDateTime requestedExpiry,
            String actorSubject,
            String reason
    ) {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime expiresAt = resolveExpiry(requestedExpiry, now);
        List<AgentCredential> activeCredentials = credentialRepository
                .findByAgentIdAndStatusForUpdate(agent.getId(), ACTIVE);
        activeCredentials.forEach(previous -> {
            previous.setStatus(REVOKED);
            previous.setRevokedAt(now);
            previous.setUpdatedAt(now);
            credentialRepository.save(previous);
        });
        String token = generateSecret();
        AgentCredential replacement = credentialRepository.save(AgentCredential.builder()
                .credentialId("agentcred-" + UUID.randomUUID())
                .agent(agent)
                .tokenHash(passwordEncoder.encode(token))
                .status(ACTIVE)
                .expiresAt(expiresAt)
                .createdAt(now)
                .updatedAt(now)
                .build());

        if (activeCredentials.isEmpty()) {
            recordRotation(agent, null, replacement, "ISSUED", actorSubject, reason, now);
        } else {
            activeCredentials.forEach(previous -> {
                recordRotation(agent, previous, replacement, "ROTATED", actorSubject, reason, now);
            });
        }
        return new IssuedAgentCredentialView(
                replacement.getCredentialId(),
                agent.getAgentId(),
                agent.getSite().getCode(),
                token,
                replacement.getExpiresAt(),
                replacement.getCreatedAt()
        );
    }

    private void recordRotation(
            EdgeAgent agent,
            AgentCredential previous,
            AgentCredential replacement,
            String action,
            String actorSubject,
            String reason,
            LocalDateTime occurredAt
    ) {
        rotationRepository.save(AgentCredentialRotation.builder()
                .agent(agent)
                .previousCredential(previous)
                .replacementCredential(replacement)
                .action(action)
                .actorSubject(normalizeOptional(actorSubject))
                .reason(normalizeOptional(reason))
                .occurredAt(occurredAt)
                .build());
    }

    private EdgeAgent requireAgent(String agentId) {
        return agentRepository.findByAgentId(requiredText(agentId, "agentId"))
                .orElseThrow(() -> new NoSuchElementException("Edge agent not found"));
    }

    private EdgeAgent requireAgentForUpdate(String agentId) {
        return agentRepository.findByAgentIdForUpdate(requiredText(agentId, "agentId"))
                .orElseThrow(() -> new NoSuchElementException("Edge agent not found"));
    }

    private LocalDateTime resolveExpiry(LocalDateTime requestedExpiry, LocalDateTime now) {
        LocalDateTime maxExpiry = now.plusDays(MAX_LIFETIME_DAYS);
        LocalDateTime expiry = requestedExpiry == null ? maxExpiry : requestedExpiry;
        if (!expiry.isAfter(now)) {
            throw new IllegalArgumentException("Credential expiry must be in the future");
        }
        if (expiry.isAfter(maxExpiry)) {
            throw new IllegalArgumentException("Credential expiry cannot exceed " + MAX_LIFETIME_DAYS + " days");
        }
        return expiry;
    }

    private String generateSecret() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return "iat_" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String requiredText(String value, String field) {
        String normalized = normalizeOptional(value);
        if (normalized == null) {
            throw new IllegalArgumentException(field + " is required");
        }
        return normalized;
    }

    private String normalizeOptional(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private AgentCredentialView toView(AgentCredential credential) {
        EdgeAgent agent = credential.getAgent();
        Site site = agent.getSite();
        return new AgentCredentialView(
                credential.getCredentialId(),
                agent.getAgentId(),
                site.getId(),
                site.getCode(),
                credential.getStatus(),
                credential.getExpiresAt(),
                credential.getLastUsedAt(),
                credential.getRevokedAt(),
                credential.getCreatedAt()
        );
    }

    public record AuthenticatedAgent(
            Long agentDatabaseId,
            String agentId,
            Long siteId,
            String siteCode,
            String credentialId
    ) {
    }

    public record AgentContext(Long agentDatabaseId, String agentId, Long siteId, String siteCode) {
    }
}
