package com.iot.manager.service;

import com.iot.manager.config.BootstrapOwnerProperties;
import com.iot.manager.entity.AppUser;
import com.iot.manager.entity.Organization;
import com.iot.manager.entity.OrganizationMembership;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.SiteMembership;
import com.iot.manager.entity.Space;
import com.iot.manager.repository.AppUserRepository;
import com.iot.manager.repository.OrganizationMembershipRepository;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteMembershipRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SpaceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Production cannot start with an unowned organization. This runner maps one
 * explicitly supplied Keycloak owner subject to the first organization and
 * site. The isolated integration runtime may additionally map ADMIN,
 * OPERATOR and VIEWER subjects to that site so the real Keycloak role matrix
 * can be exercised end-to-end. It is idempotent and deliberately has no
 * password or Keycloak administrator credential.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ProductionBootstrapOwnerService implements ApplicationRunner {

    private final BootstrapOwnerProperties properties;
    private final AppUserRepository appUserRepository;
    private final OrganizationRepository organizationRepository;
    private final SiteRepository siteRepository;
    private final SpaceRepository spaceRepository;
    private final OrganizationMembershipRepository organizationMembershipRepository;
    private final SiteMembershipRepository siteMembershipRepository;

    @Override
    public void run(ApplicationArguments args) {
        if (!properties.isRequireOwner()) return;
        provisionOwner();
    }

    @Transactional
    public void provisionOwner() {
        String ownerSubject = required(properties.getOwnerSubject(), "iot.bootstrap.owner-subject");
        String ownerUsername = required(properties.getOwnerUsername(), "iot.bootstrap.owner-username");
        String organizationCode = required(properties.getOrganizationCode(), "iot.bootstrap.organization-code");
        String organizationName = required(properties.getOrganizationName(), "iot.bootstrap.organization-name");
        String siteCode = required(properties.getSiteCode(), "iot.bootstrap.site-code");
        String siteName = required(properties.getSiteName(), "iot.bootstrap.site-name");
        String spacePath = required(properties.getSpacePath(), "iot.bootstrap.space-path");
        String spaceName = required(properties.getSpaceName(), "iot.bootstrap.space-name");
        validateIntegrationIdentityConfiguration();

        Organization organization = organizationRepository.findByCode(organizationCode)
                .orElseGet(() -> organizationRepository.save(Organization.builder()
                        .code(organizationCode)
                        .name(organizationName)
                        .build()));
        Site site = siteRepository.findByOrganizationAndCode(organization, siteCode)
                .orElseGet(() -> siteRepository.save(Site.builder()
                        .organization(organization)
                        .code(siteCode)
                        .name(siteName)
                        .build()));
        spaceRepository.findBySiteAndPath(site, spacePath)
                .orElseGet(() -> spaceRepository.save(Space.builder()
                        .site(site)
                        .name(spaceName)
                        .path(spacePath)
                        .build()));

        AppUser owner = provisionUser(
                "owner", ownerSubject, ownerUsername,
                properties.getOwnerDisplayName(), properties.getOwnerEmail()
        );
        ensureOrganizationMembership(owner, organization);
        ensureSiteMembership(owner, site);
        log.info("Initial platform owner membership is ready for organization {} and site {}", organizationCode, siteCode);
        provisionSecondarySiteIfConfigured(organization, owner, site);
        provisionAdditionalIdentities(organization, site);
    }

    private void provisionSecondarySiteIfConfigured(Organization organization, AppUser owner, Site primarySite) {
        String secondaryCode = blankToNull(properties.getSecondarySiteCode());
        if (secondaryCode == null) {
            return;
        }
        String secondaryName = required(properties.getSecondarySiteName(), "iot.bootstrap.secondary-site-name");
        if (secondaryCode.equals(primarySite.getCode())) {
            throw new IllegalStateException("Production bootstrap secondary site must differ from iot.bootstrap.site-code");
        }
        Site secondary = siteRepository.findByOrganizationAndCode(organization, secondaryCode)
                .orElseGet(() -> siteRepository.save(Site.builder()
                        .organization(organization)
                        .code(secondaryCode)
                        .name(secondaryName)
                        .build()));
        spaceRepository.findBySiteAndPath(secondary, properties.getSpacePath())
                .orElseGet(() -> spaceRepository.save(Space.builder()
                        .site(secondary)
                        .name(properties.getSpaceName())
                        .path(properties.getSpacePath())
                        .build()));
        // OWNER holds organization membership, but retain an explicit site
        // membership so the initial topology stays intelligible if that
        // broader grant is later replaced by site-only access.
        ensureSiteMembership(owner, secondary);
        log.info("Initial secondary site is ready for organization {} and site {}", organization.getCode(), secondaryCode);
    }

    private void provisionAdditionalIdentities(Organization organization, Site site) {
        if (properties.isIntegrationIdentitiesEnabled()) {
            provisionIntegrationIdentity(
                    "admin", properties.getAdminSubject(), properties.getAdminUsername(),
                    properties.getAdminDisplayName(), properties.getAdminEmail(), organization, site
            );
            provisionIntegrationIdentity(
                    "operator", properties.getOperatorSubject(), properties.getOperatorUsername(),
                    properties.getOperatorDisplayName(), properties.getOperatorEmail(), organization, site
            );
            provisionIntegrationIdentity(
                    "viewer", properties.getViewerSubject(), properties.getViewerUsername(),
                    properties.getViewerDisplayName(), properties.getViewerEmail(), organization, site
            );
            return;
        }

        // Keep the pre-existing, deliberate production viewer onboarding path
        // compatible. Unlike integration identities it is never created by
        // Keycloak bootstrap unless a deployment explicitly configures it.
        String viewerSubject = blankToNull(properties.getViewerSubject());
        if (viewerSubject != null) {
            provisionIntegrationIdentity(
                    "viewer", viewerSubject, properties.getViewerUsername(),
                    properties.getViewerDisplayName(), properties.getViewerEmail(), organization, site
            );
        }
    }

    private void validateIntegrationIdentityConfiguration() {
        if (!properties.isIntegrationIdentitiesEnabled()) {
            return;
        }
        validateIntegrationIdentity("admin", properties.getAdminSubject(), properties.getAdminUsername(),
                properties.getAdminDisplayName(), properties.getAdminEmail());
        validateIntegrationIdentity("operator", properties.getOperatorSubject(), properties.getOperatorUsername(),
                properties.getOperatorDisplayName(), properties.getOperatorEmail());
        validateIntegrationIdentity("viewer", properties.getViewerSubject(), properties.getViewerUsername(),
                properties.getViewerDisplayName(), properties.getViewerEmail());
    }

    private void validateIntegrationIdentity(
            String identity, String subject, String username, String displayName, String email
    ) {
        required(subject, "iot.bootstrap." + identity + "-subject");
        required(username, "iot.bootstrap." + identity + "-username");
        required(displayName, "iot.bootstrap." + identity + "-display-name");
        required(email, "iot.bootstrap." + identity + "-email");
    }

    private void provisionIntegrationIdentity(
            String identity,
            String subject,
            String username,
            String displayName,
            String email,
            Organization organization,
            Site site
    ) {
        AppUser user = provisionUser(identity, required(subject, "iot.bootstrap." + identity + "-subject"),
                required(username, "iot.bootstrap." + identity + "-username"), displayName, email);
        ensureSiteMembership(user, site);
        log.info("Initial platform {} membership is ready for organization {} and site {}",
                identity, organization.getCode(), site.getCode());
    }

    private AppUser provisionUser(
            String identity,
            String subject,
            String username,
            String displayName,
            String email
    ) {
        AppUser user = appUserRepository.findBySubject(subject)
                .orElseGet(() -> appUserRepository.save(AppUser.builder()
                        .subject(subject)
                        .username(username)
                        .displayName(blankToNull(displayName))
                        .email(blankToNull(email))
                        .enabled(true)
                        .build()));
        if (!user.isEnabled()) {
            throw new IllegalStateException("Configured production " + identity + " is disabled");
        }
        return user;
    }

    private void ensureOrganizationMembership(AppUser user, Organization organization) {
        if (!organizationMembershipRepository.existsByUserIdAndOrganizationId(user.getId(), organization.getId())) {
            organizationMembershipRepository.save(OrganizationMembership.builder()
                    .user(user)
                    .organization(organization)
                    .build());
        }
    }

    private void ensureSiteMembership(AppUser user, Site site) {
        if (!siteMembershipRepository.existsByUserIdAndSiteId(user.getId(), site.getId())) {
            siteMembershipRepository.save(SiteMembership.builder()
                    .user(user)
                    .site(site)
                    .build());
        }
    }

    private String required(String value, String property) {
        String normalized = blankToNull(value);
        if (normalized == null) {
            throw new IllegalStateException("Production bootstrap requires " + property);
        }
        return normalized;
    }

    private String blankToNull(String value) {
        if (value == null || value.isBlank()) return null;
        return value.trim();
    }
}
