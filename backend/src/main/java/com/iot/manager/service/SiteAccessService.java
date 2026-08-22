package com.iot.manager.service;

import com.iot.manager.config.IotSecurityProperties;
import com.iot.manager.entity.AppUser;
import com.iot.manager.entity.Alert;
import com.iot.manager.entity.CommandBatch;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceCommand;
import com.iot.manager.entity.DeviceGroup;
import com.iot.manager.entity.DiscoveredDevice;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.Space;
import com.iot.manager.dto.SiteView;
import com.iot.manager.dto.CurrentUserView;
import com.iot.manager.repository.AppUserRepository;
import com.iot.manager.repository.AlertRepository;
import com.iot.manager.repository.CommandBatchRepository;
import com.iot.manager.repository.DeviceCommandRepository;
import com.iot.manager.repository.DeviceGroupRepository;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.DiscoveredDeviceRepository;
import com.iot.manager.repository.OrganizationMembershipRepository;
import com.iot.manager.repository.SiteMembershipRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SpaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.NoSuchElementException;

/**
 * Resolves an authenticated Keycloak subject to the sites it may operate.
 * Role checks happen in the HTTP security filter; this service enforces the
 * separate organization/site data boundary at the controller/service edge.
 */
@Service
@RequiredArgsConstructor
public class SiteAccessService {

    private final IotSecurityProperties securityProperties;
    private final AppUserRepository userRepository;
    private final OrganizationMembershipRepository organizationMembershipRepository;
    private final SiteMembershipRepository siteMembershipRepository;
    private final SiteRepository siteRepository;
    private final DeviceRepository deviceRepository;
    private final DeviceCommandRepository deviceCommandRepository;
    private final AlertRepository alertRepository;
    private final CommandBatchRepository commandBatchRepository;
    private final DeviceGroupRepository deviceGroupRepository;
    private final DiscoveredDeviceRepository discoveredDeviceRepository;
    private final SpaceRepository spaceRepository;

    public boolean isScopeEnforced() {
        return securityProperties.isEnabled();
    }

    @Transactional(readOnly = true)
    public Site requireSiteAccess(String siteCode) {
        String normalizedSiteCode = normalizeSiteCode(siteCode);
        List<Site> candidates = siteRepository.findAllByCode(normalizedSiteCode);
        if (candidates.isEmpty()) {
            throw new NoSuchElementException("Site not found");
        }
        if (!securityProperties.isEnabled()) {
            return candidates.stream().min(Comparator.comparing(Site::getId)).orElseThrow();
        }

        AppUser user = currentUser();
        List<Site> allowed = candidates.stream()
                .filter(site -> hasMembership(user, site))
                .toList();
        if (allowed.isEmpty()) {
            throw new AccessDeniedException("You do not have access to this site");
        }
        if (allowed.size() > 1) {
            throw new AccessDeniedException("Site code is ambiguous across your memberships");
        }
        return allowed.get(0);
    }

    /** Uses an already-resolved site entity to avoid any ambiguity from site
     * codes that are only unique within an organization. */
    @Transactional(readOnly = true)
    public Site requireSiteAccess(Site site) {
        if (site == null || site.getId() == null) {
            throw new NoSuchElementException("Site not found");
        }
        requireEntitySiteAccess(site);
        return site;
    }

    @Transactional(readOnly = true)
    public Site requireSiteAccess(Long siteId) {
        if (siteId == null) {
            throw new NoSuchElementException("Site not found");
        }
        Site site = siteRepository.findById(siteId)
                .orElseThrow(() -> new NoSuchElementException("Site not found"));
        return requireSiteAccess(site);
    }

    @Transactional(readOnly = true)
    public List<Site> accessibleSites() {
        if (!securityProperties.isEnabled()) {
            return siteRepository.findAll().stream()
                    .sorted(Comparator.comparing(Site::getId))
                    .toList();
        }
        AppUser user = currentUser();
        return siteRepository.findAll().stream()
                .filter(site -> hasMembership(user, site))
                .sorted(Comparator.comparing(Site::getId))
                .toList();
    }

    /**
     * Projects site contexts while the read-only transaction is open.  This
     * keeps the public API independent of Open Session in View and prevents a
     * controller from dereferencing a lazy organization association.
     */
    @Transactional(readOnly = true)
    public List<SiteView> accessibleSiteViews() {
        return accessibleSites().stream()
                .map(site -> new SiteView(
                        site.getId(),
                        site.getOrganization().getCode(),
                        site.getOrganization().getName(),
                        site.getCode(),
                        site.getName()
                ))
                .toList();
    }

    /**
     * Returns only the authenticated user's own identity and authorized
     * contexts. It is intentionally unavailable in R0 because an open local
     * profile has no trustworthy principal to expose.
     */
    @Transactional(readOnly = true)
    public CurrentUserView currentUserView() {
        if (!isScopeEnforced()) {
            throw new AccessDeniedException("Identity endpoint requires authenticated security mode");
        }
        AppUser user = currentUser();
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        List<String> roles = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(authority -> authority != null && authority.startsWith("ROLE_"))
                .map(authority -> authority.substring("ROLE_".length()))
                .sorted()
                .toList();
        return new CurrentUserView(
                user.getId(), user.getSubject(), user.getUsername(), user.getDisplayName(), user.getEmail(),
                roles, accessibleSiteViews()
        );
    }

    /**
     * Returns the site ids visible to the current principal.  A null result
     * means that local R0 mode deliberately keeps the legacy unscoped flow.
     */
    @Transactional(readOnly = true)
    public List<Long> accessibleSiteIds() {
        if (!isScopeEnforced()) {
            return null;
        }
        return accessibleSites().stream().map(Site::getId).toList();
    }

    /** Resolves memberships from a handshake principal, without relying on a
     * thread-bound SecurityContext that may not survive WebSocket upgrades. */
    @Transactional(readOnly = true)
    public List<Long> accessibleSiteIdsForSubject(String subject) {
        if (!isScopeEnforced()) {
            return null;
        }
        if (subject == null || subject.isBlank()) {
            throw new AccessDeniedException("Bearer token has no subject");
        }
        AppUser user = userRepository.findBySubjectAndEnabledTrue(subject.trim())
                .orElseThrow(() -> new AccessDeniedException("No active platform membership exists for this user"));
        return siteRepository.findAll().stream()
                .filter(site -> hasMembership(user, site))
                .map(Site::getId)
                .sorted()
                .toList();
    }

    @Transactional(readOnly = true)
    public List<Long> siteIdsForSubjectAndCode(String subject, String siteCode) {
        if (!isScopeEnforced()) {
            return null;
        }
        List<Long> allowed = accessibleSiteIdsForSubject(subject);
        if (siteCode == null || siteCode.isBlank()) {
            return allowed;
        }
        List<Site> matches = siteRepository.findAllByCode(siteCode.trim()).stream()
                .filter(candidate -> allowed.contains(candidate.getId()))
                .toList();
        if (matches.isEmpty()) {
            throw new AccessDeniedException("You do not have access to this site");
        }
        if (matches.size() > 1) {
            throw new AccessDeniedException("Site code is ambiguous across your memberships");
        }
        return List.of(matches.get(0).getId());
    }

    @Transactional(readOnly = true)
    public List<String> accessibleSiteCodes() {
        return accessibleSites().stream().map(Site::getCode).toList();
    }

    /**
     * Resolves an optional collection scope.  In secure mode an omitted site
     * means all memberships; an explicit site is still checked against the
     * authenticated user's memberships.  R0 returns null so existing local
     * demo endpoints retain their historical behaviour.
     */
    @Transactional(readOnly = true)
    public List<Long> siteIdsFor(String siteCode) {
        if (siteCode == null || siteCode.isBlank()) {
            return accessibleSiteIds();
        }
        return List.of(requireSiteAccess(siteCode).getId());
    }

    @Transactional(readOnly = true)
    public Device requireDeviceAccess(Long deviceId) {
        Device device = deviceRepository.findById(deviceId)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
        requireEntitySiteAccess(device.getSite());
        return device;
    }

    @Transactional(readOnly = true)
    public Space requireDefaultSpace(Site site) {
        return spaceRepository.findFirstBySiteIdOrderById(site.getId())
                .orElseThrow(() -> new NoSuchElementException("Site has no configured space"));
    }

    @Transactional(readOnly = true)
    public Device requireDeviceAccessByDeviceId(String deviceId) {
        Device device = deviceRepository.findByDeviceId(deviceId)
                .orElseThrow(() -> new NoSuchElementException("Device not found"));
        requireEntitySiteAccess(device.getSite());
        return device;
    }

    @Transactional(readOnly = true)
    public DeviceCommand requireCommandAccess(String commandId) {
        DeviceCommand command = deviceCommandRepository.findByCommandId(commandId)
                .orElseThrow(() -> new NoSuchElementException("Command not found"));
        requireEntitySiteAccess(command.getDevice() == null ? null : command.getDevice().getSite());
        return command;
    }

    @Transactional(readOnly = true)
    public Alert requireAlertAccess(Long alertId) {
        Alert alert = alertRepository.findById(alertId)
                .orElseThrow(() -> new NoSuchElementException("Alert not found"));
        requireEntitySiteAccess(alert.getDevice() == null ? null : alert.getDevice().getSite());
        return alert;
    }

    @Transactional(readOnly = true)
    public CommandBatch requireBatchAccess(String batchId) {
        CommandBatch batch = commandBatchRepository.findByBatchId(batchId)
                .orElseThrow(() -> new NoSuchElementException("Command batch not found"));
        requireEntitySiteAccess(batch.getSite());
        return batch;
    }

    @Transactional(readOnly = true)
    public DeviceGroup requireGroupAccess(String groupId) {
        DeviceGroup group = deviceGroupRepository.findByPublicId(groupId)
                .orElseThrow(() -> new NoSuchElementException("Device group not found"));
        requireEntitySiteAccess(group.getSite());
        return group;
    }

    @Transactional(readOnly = true)
    public DiscoveredDevice requireCandidateAccess(String candidateId) {
        DiscoveredDevice candidate = discoveredDeviceRepository.findByCandidateId(candidateId)
                .orElseThrow(() -> new NoSuchElementException("LAN candidate not found"));
        Site site = candidate.getAgent() == null ? null : candidate.getAgent().getSite();
        requireEntitySiteAccess(site);
        return candidate;
    }

    private boolean hasMembership(AppUser user, Site site) {
        return siteMembershipRepository.existsByUserIdAndSiteId(user.getId(), site.getId())
                || organizationMembershipRepository.existsByUserIdAndOrganizationId(
                        user.getId(), site.getOrganization().getId()
                );
    }

    private void requireEntitySiteAccess(Site site) {
        if (!isScopeEnforced()) {
            return;
        }
        if (site == null) {
            throw new AccessDeniedException("Resource is not assigned to a site");
        }
        AppUser user = currentUser();
        if (!hasMembership(user, site)) {
            throw new AccessDeniedException("You do not have access to this resource's site");
        }
    }

    private AppUser currentUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken jwtAuthentication) || !authentication.isAuthenticated()) {
            throw new AccessDeniedException("A verified bearer token is required");
        }
        String subject = jwtAuthentication.getToken().getSubject();
        if (subject == null || subject.isBlank()) {
            throw new AccessDeniedException("Bearer token has no subject");
        }
        return userRepository.findBySubjectAndEnabledTrue(subject)
                .orElseThrow(() -> new AccessDeniedException("No active platform membership exists for this user"));
    }

    private String normalizeSiteCode(String siteCode) {
        if (siteCode == null || siteCode.isBlank()) {
            throw new IllegalArgumentException("siteCode is required");
        }
        return siteCode.trim();
    }
}
