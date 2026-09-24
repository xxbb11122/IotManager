package com.iot.manager.service;

import com.iot.manager.dto.RetentionHoldRequest;
import com.iot.manager.dto.RetentionHoldView;
import com.iot.manager.entity.RetentionHold;
import com.iot.manager.entity.RetentionHoldEvent;
import com.iot.manager.repository.RetentionHoldEventRepository;
import com.iot.manager.repository.RetentionHoldRepository;
import com.iot.manager.repository.ScheduledTaskLockRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Owns retention holds and their audit trail.  The retention worker receives a
 * fresh snapshot of active holds for every batch while holding a shared guard
 * row. A concurrently created hold becomes effective before the next batch.
 */
@Service
@RequiredArgsConstructor
public class RetentionHoldService {

    public static final String GLOBAL = "GLOBAL";
    public static final String DATA_CATEGORY = "DATA_CATEGORY";
    public static final String SITE = "SITE";
    public static final String DEVICE = "DEVICE";
    public static final String COMMAND = "COMMAND";
    public static final String AUDIT_CATEGORY = "AUDIT_CATEGORY";
    public static final String HOLD_GUARD_TASK = "retention-hold-guard";

    private static final Set<String> SUPPORTED_SCOPES = Set.of(
            GLOBAL, DATA_CATEGORY, SITE, DEVICE, COMMAND, AUDIT_CATEGORY
    );
    private static final Set<String> RETENTION_CATEGORIES = Set.of(
            "TELEMETRY", "ACTIVITY_EVENTS", "COMMAND_EVENTS", "COMMANDS", "ALERTS",
            "WEATHER_SNAPSHOTS", "WEATHER_FORECASTS", "WEATHER_PROVIDER_AUDIT",
            "CREDENTIAL_ROTATIONS"
    );

    private final RetentionHoldRepository holdRepository;
    private final RetentionHoldEventRepository holdEventRepository;
    private final ScheduledTaskLockRepository scheduledTaskLockRepository;
    private final AuditContextService auditContextService;
    private final SiteAccessService siteAccessService;
    private final TimeProvider timeProvider;

    @Transactional
    public RetentionHoldView create(RetentionHoldRequest request) {
        String scopeType = normalizedScope(request.scopeType());
        String scopeId = normalizedScopeId(scopeType, request.scopeId());
        requireScopeAccess(scopeType, scopeId);
        lockMutationsAgainstRetention();
        Instant now = timeProvider.now();
        if (request.endsAt() != null && !request.endsAt().isAfter(now)) {
            throw new IllegalArgumentException("Retention hold end time must be in the future");
        }
        String subject = auditContextService.currentSubjectOrAnonymous();
        RetentionHold hold = holdRepository.save(RetentionHold.builder()
                .scopeType(scopeType)
                .scopeId(scopeId)
                .startsAt(now)
                .endsAt(request.endsAt())
                .reason(required(request.reason(), "reason", 1000))
                .createdBy(subject)
                .createdAt(now)
                .build());
        holdEventRepository.save(RetentionHoldEvent.builder()
                .hold(hold)
                .action("CREATED")
                .actorSubject(subject)
                .detail(hold.getReason())
                .occurredAt(now)
                .build());
        return toView(hold, now);
    }

    @Transactional
    public RetentionHoldView release(Long id, String reason) {
        lockMutationsAgainstRetention();
        RetentionHold hold = holdRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("Retention hold not found"));
        requireScopeAccess(hold.getScopeType(), hold.getScopeId());
        Instant now = timeProvider.now();
        if (hold.getReleasedAt() == null) {
            String subject = auditContextService.currentSubjectOrAnonymous();
            hold.setReleasedAt(now);
            hold.setReleasedBy(subject);
            holdEventRepository.save(RetentionHoldEvent.builder()
                    .hold(hold)
                    .action("RELEASED")
                    .actorSubject(subject)
                    .detail(normalizeOptional(reason, 1000))
                    .occurredAt(now)
                    .build());
        }
        return toView(hold, now);
    }

    private void lockMutationsAgainstRetention() {
        scheduledTaskLockRepository.findForUpdate(HOLD_GUARD_TASK)
                .orElseThrow(() -> new IllegalStateException("Retention hold guard row is missing"));
    }

    @Transactional(readOnly = true)
    public List<RetentionHoldView> list(boolean activeOnly) {
        Instant now = timeProvider.now();
        Collection<RetentionHold> holds = activeOnly ? holdRepository.findActiveAt(now) : holdRepository.findAll();
        return holds.stream().filter(this::isVisibleToCurrentUser).map(hold -> toView(hold, now)).toList();
    }

    private boolean isVisibleToCurrentUser(RetentionHold hold) {
        try {
            requireScopeAccess(hold.getScopeType(), hold.getScopeId());
            return true;
        } catch (AccessDeniedException | NoSuchElementException exception) {
            return false;
        }
    }

    private void requireScopeAccess(String scopeType, String scopeId) {
        switch (scopeType) {
            case SITE -> siteAccessService.requireSiteAccess(parseId(scopeId));
            case DEVICE -> siteAccessService.requireDeviceAccess(parseId(scopeId));
            case COMMAND -> siteAccessService.requireCommandAccess(scopeId);
            case GLOBAL, DATA_CATEGORY, AUDIT_CATEGORY -> {
                if (!siteAccessService.isScopeEnforced()) return;
                Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
                if (authentication == null || authentication.getAuthorities().stream()
                        .noneMatch(authority -> "ROLE_OWNER".equals(authority.getAuthority()))) {
                    throw new AccessDeniedException("Only an owner may manage platform-wide retention holds");
                }
                siteAccessService.accessibleSites();
            }
            default -> throw new IllegalArgumentException("Unsupported retention hold scope type");
        }
    }

    private Long parseId(String scopeId) {
        try {
            return Long.valueOf(scopeId);
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException("Retention hold scopeId must be a numeric ID", exception);
        }
    }

    @Transactional(readOnly = true)
    public ActiveHoldIndex activeIndex(Instant now) {
        return new ActiveHoldIndex(holdRepository.findActiveAt(now));
    }

    private String normalizedScope(String value) {
        String normalized = required(value, "scopeType", 40).toUpperCase(Locale.ROOT);
        if (!SUPPORTED_SCOPES.contains(normalized)) {
            throw new IllegalArgumentException("Unsupported retention hold scope type");
        }
        return normalized;
    }

    private String normalizedScopeId(String scopeType, String value) {
        String normalized = required(value, "scopeId", 255);
        if (GLOBAL.equals(scopeType) && !"*".equals(normalized)) {
            throw new IllegalArgumentException("GLOBAL retention holds must use scopeId '*'");
        }
        if (DATA_CATEGORY.equals(scopeType) || AUDIT_CATEGORY.equals(scopeType)) {
            String category = normalized.toUpperCase(Locale.ROOT);
            if (!RETENTION_CATEGORIES.contains(category)) {
                throw new IllegalArgumentException("Unsupported retention hold data category");
            }
            return category;
        }
        if (SITE.equals(scopeType) || DEVICE.equals(scopeType)) {
            long id = parseId(normalized);
            if (id < 1) throw new IllegalArgumentException("Retention hold scopeId must be a positive numeric ID");
            return Long.toString(id);
        }
        return normalized;
    }

    private String required(String value, String field, int maxLength) {
        String normalized = normalizeOptional(value, maxLength);
        if (normalized == null) throw new IllegalArgumentException(field + " is required");
        return normalized;
    }

    private String normalizeOptional(String value, int maxLength) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.trim();
        if (normalized.length() > maxLength) throw new IllegalArgumentException("Value is too long");
        return normalized;
    }

    private RetentionHoldView toView(RetentionHold hold, Instant now) {
        boolean active = hold.getReleasedAt() == null
                && !hold.getStartsAt().isAfter(now)
                && (hold.getEndsAt() == null || hold.getEndsAt().isAfter(now));
        return new RetentionHoldView(
                hold.getId(), hold.getScopeType(), hold.getScopeId(), hold.getStartsAt(), hold.getEndsAt(),
                hold.getReason(), hold.getCreatedBy(), hold.getCreatedAt(), hold.getReleasedBy(), hold.getReleasedAt(), active
        );
    }

    public static final class ActiveHoldIndex {
        private final Set<String> keys;

        private ActiveHoldIndex(Collection<RetentionHold> holds) {
            this.keys = holds.stream()
                    .map(hold -> key(hold.getScopeType(), hold.getScopeId()))
                    .collect(Collectors.toUnmodifiableSet());
        }

        public boolean blocksTelemetry(Long deviceId, Long siteId) {
            return blocksCategory("TELEMETRY")
                    || matches(DEVICE, deviceId)
                    || matches(SITE, siteId);
        }

        public boolean blocksCategory(String category) {
            return keys.contains(key(GLOBAL, "*"))
                    || keys.contains(key(DATA_CATEGORY, category))
                    || keys.contains(key(AUDIT_CATEGORY, category));
        }

        public boolean matches(String scopeType, Long id) {
            return id != null && keys.contains(key(scopeType, String.valueOf(id)));
        }

        public boolean matchesCommand(String commandId) {
            return commandId != null && keys.contains(key(COMMAND, commandId));
        }

        private static String key(String scopeType, String scopeId) {
            return scopeType + "|" + scopeId;
        }
    }
}
