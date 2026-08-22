package com.iot.manager.service;

import com.iot.manager.entity.AppUser;
import com.iot.manager.repository.AppUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

/**
 * Resolves only verified JWT principals for audit persistence.  R0 system and
 * simulator work deliberately return a null actor id instead of manufacturing
 * an AppUser identity that never authenticated.
 */
@Service
@RequiredArgsConstructor
public class AuditContextService {

    private static final String ANONYMOUS = "anonymous";
    private static final int REQUESTED_BY_MAX_LENGTH = 100;

    private final AppUserRepository appUserRepository;

    @Transactional(readOnly = true)
    public Long currentActorId() {
        return authenticatedSubject()
                .flatMap(appUserRepository::findBySubjectAndEnabledTrue)
                .map(AppUser::getId)
                .orElse(null);
    }

    /**
     * Produces a bounded subject for legacy string audit columns such as
     * requested_by and archived_by.  The numeric event actor is authoritative
     * when an AppUser mapping exists.
     */
    public String currentSubjectOrAnonymous() {
        return authenticatedSubject()
                .map(subject -> subject.length() <= REQUESTED_BY_MAX_LENGTH
                        ? subject
                        : subject.substring(0, REQUESTED_BY_MAX_LENGTH))
                .orElse(ANONYMOUS);
    }

    private Optional<String> authenticatedSubject() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken jwtAuthentication)
                || !authentication.isAuthenticated()) {
            return Optional.empty();
        }
        String subject = jwtAuthentication.getToken().getSubject();
        if (subject == null || subject.isBlank()) {
            return Optional.empty();
        }
        return Optional.of(subject.trim());
    }
}
