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
 * explicitly supplied Keycloak subject to the first organization and site. It
 * is idempotent and deliberately has no password or Keycloak admin credential.
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

        AppUser owner = appUserRepository.findBySubject(ownerSubject)
                .orElseGet(() -> appUserRepository.save(AppUser.builder()
                        .subject(ownerSubject)
                        .username(ownerUsername)
                        .displayName(blankToNull(properties.getOwnerDisplayName()))
                        .email(blankToNull(properties.getOwnerEmail()))
                        .enabled(true)
                        .build()));
        if (!owner.isEnabled()) {
            throw new IllegalStateException("Configured production owner is disabled");
        }
        if (!organizationMembershipRepository.existsByUserIdAndOrganizationId(owner.getId(), organization.getId())) {
            organizationMembershipRepository.save(OrganizationMembership.builder()
                    .user(owner)
                    .organization(organization)
                    .build());
        }
        if (!siteMembershipRepository.existsByUserIdAndSiteId(owner.getId(), site.getId())) {
            siteMembershipRepository.save(SiteMembership.builder()
                    .user(owner)
                    .site(site)
                    .build());
        }
        log.info("Initial platform owner membership is ready for organization {} and site {}", organizationCode, siteCode);
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
