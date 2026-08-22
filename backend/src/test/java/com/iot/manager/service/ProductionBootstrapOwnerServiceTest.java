package com.iot.manager.service;

import com.iot.manager.config.BootstrapOwnerProperties;
import com.iot.manager.entity.AppUser;
import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.Space;
import com.iot.manager.repository.AppUserRepository;
import com.iot.manager.repository.OrganizationMembershipRepository;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteMembershipRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SpaceRepository;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProductionBootstrapOwnerServiceTest {

    @Test
    void mapsTheExplicitKeycloakSubjectToTheConfiguredOrganizationAndSite() {
        BootstrapOwnerProperties properties = validProperties();
        AppUserRepository users = mock(AppUserRepository.class);
        OrganizationRepository organizations = mock(OrganizationRepository.class);
        SiteRepository sites = mock(SiteRepository.class);
        SpaceRepository spaces = mock(SpaceRepository.class);
        OrganizationMembershipRepository organizationMemberships = mock(OrganizationMembershipRepository.class);
        SiteMembershipRepository siteMemberships = mock(SiteMembershipRepository.class);

        Organization organization = Organization.builder().id(1L).code("org-a").name("Org A").build();
        Site site = Site.builder().id(2L).organization(organization).code("site-a").name("Site A").build();
        Space space = Space.builder().id(3L).site(site).path("/operations").name("Operations").build();
        AppUser owner = AppUser.builder().id(4L).subject("subject-1").username("owner").enabled(true).build();
        when(organizations.findByCode("org-a")).thenReturn(Optional.of(organization));
        when(sites.findByOrganizationAndCode(organization, "site-a")).thenReturn(Optional.of(site));
        when(spaces.findBySiteAndPath(site, "/operations")).thenReturn(Optional.of(space));
        when(users.findBySubject("subject-1")).thenReturn(Optional.of(owner));
        when(organizationMemberships.existsByUserIdAndOrganizationId(4L, 1L)).thenReturn(false);
        when(siteMemberships.existsByUserIdAndSiteId(4L, 2L)).thenReturn(false);

        service(properties, users, organizations, sites, spaces, organizationMemberships, siteMemberships).provisionOwner();

        verify(organizationMemberships).save(any());
        verify(siteMemberships).save(any());
    }

    @Test
    void rejectsProductionBootstrapWithoutAnExplicitOwnerSubject() {
        BootstrapOwnerProperties properties = validProperties();
        properties.setOwnerSubject(" ");

        assertThatThrownBy(() -> service(
                properties,
                mock(AppUserRepository.class), mock(OrganizationRepository.class), mock(SiteRepository.class),
                mock(SpaceRepository.class), mock(OrganizationMembershipRepository.class), mock(SiteMembershipRepository.class)
        ).provisionOwner()).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("owner-subject");
    }

    private ProductionBootstrapOwnerService service(
            BootstrapOwnerProperties properties,
            AppUserRepository users,
            OrganizationRepository organizations,
            SiteRepository sites,
            SpaceRepository spaces,
            OrganizationMembershipRepository organizationMemberships,
            SiteMembershipRepository siteMemberships
    ) {
        return new ProductionBootstrapOwnerService(
                properties, users, organizations, sites, spaces, organizationMemberships, siteMemberships
        );
    }

    private BootstrapOwnerProperties validProperties() {
        BootstrapOwnerProperties properties = new BootstrapOwnerProperties();
        properties.setRequireOwner(true);
        properties.setOwnerSubject("subject-1");
        properties.setOwnerUsername("owner");
        properties.setOrganizationCode("org-a");
        properties.setOrganizationName("Org A");
        properties.setSiteCode("site-a");
        properties.setSiteName("Site A");
        properties.setSpacePath("/operations");
        properties.setSpaceName("Operations");
        return properties;
    }
}
