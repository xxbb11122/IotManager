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
import org.mockito.ArgumentCaptor;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
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

    @Test
    void provisionsAnOptionalViewerWithOnlyTheConfiguredSiteMembership() {
        BootstrapOwnerProperties properties = validProperties();
        properties.setViewerSubject("viewer-subject");
        properties.setViewerUsername("viewer");
        properties.setViewerDisplayName("Viewer");
        properties.setViewerEmail("viewer@example.invalid");
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
        AppUser viewer = AppUser.builder().id(5L).subject("viewer-subject").username("viewer").enabled(true).build();
        when(organizations.findByCode("org-a")).thenReturn(Optional.of(organization));
        when(sites.findByOrganizationAndCode(organization, "site-a")).thenReturn(Optional.of(site));
        when(spaces.findBySiteAndPath(site, "/operations")).thenReturn(Optional.of(space));
        when(users.findBySubject("subject-1")).thenReturn(Optional.of(owner));
        when(users.findBySubject("viewer-subject")).thenReturn(Optional.of(viewer));
        when(organizationMemberships.existsByUserIdAndOrganizationId(4L, 1L)).thenReturn(false);
        when(siteMemberships.existsByUserIdAndSiteId(4L, 2L)).thenReturn(false);
        when(siteMemberships.existsByUserIdAndSiteId(5L, 2L)).thenReturn(false);

        service(properties, users, organizations, sites, spaces, organizationMemberships, siteMemberships).provisionOwner();

        verify(organizationMemberships).save(any());
        verify(siteMemberships, times(2)).save(any());
    }

    @Test
    void provisionsAnOptionalSecondSiteForTheOwnerWithoutGrantingItToIntegrationUsers() {
        BootstrapOwnerProperties properties = validProperties();
        properties.setSecondarySiteCode("site-b");
        properties.setSecondarySiteName("Site B");
        AppUserRepository users = mock(AppUserRepository.class);
        OrganizationRepository organizations = mock(OrganizationRepository.class);
        SiteRepository sites = mock(SiteRepository.class);
        SpaceRepository spaces = mock(SpaceRepository.class);
        OrganizationMembershipRepository organizationMemberships = mock(OrganizationMembershipRepository.class);
        SiteMembershipRepository siteMemberships = mock(SiteMembershipRepository.class);

        Organization organization = Organization.builder().id(1L).code("org-a").name("Org A").build();
        Site primary = Site.builder().id(2L).organization(organization).code("site-a").name("Site A").build();
        Site secondary = Site.builder().id(3L).organization(organization).code("site-b").name("Site B").build();
        AppUser owner = AppUser.builder().id(4L).subject("subject-1").username("owner").enabled(true).build();
        when(organizations.findByCode("org-a")).thenReturn(Optional.of(organization));
        when(sites.findByOrganizationAndCode(organization, "site-a")).thenReturn(Optional.of(primary));
        when(sites.findByOrganizationAndCode(organization, "site-b")).thenReturn(Optional.of(secondary));
        when(spaces.findBySiteAndPath(any(), anyString())).thenReturn(Optional.of(mock(Space.class)));
        when(users.findBySubject("subject-1")).thenReturn(Optional.of(owner));
        when(organizationMemberships.existsByUserIdAndOrganizationId(4L, 1L)).thenReturn(false);
        when(siteMemberships.existsByUserIdAndSiteId(4L, 2L)).thenReturn(false);
        when(siteMemberships.existsByUserIdAndSiteId(4L, 3L)).thenReturn(false);

        service(properties, users, organizations, sites, spaces, organizationMemberships, siteMemberships).provisionOwner();

        verify(siteMemberships, times(2)).save(any());
        verify(sites).findByOrganizationAndCode(organization, "site-b");
    }

    @Test
    void provisionsAllIntegrationIdentitiesWithIndependentSiteMemberships() {
        BootstrapOwnerProperties properties = validProperties();
        configureIntegrationIdentities(properties);
        AppUserRepository users = mock(AppUserRepository.class);
        OrganizationRepository organizations = mock(OrganizationRepository.class);
        SiteRepository sites = mock(SiteRepository.class);
        SpaceRepository spaces = mock(SpaceRepository.class);
        OrganizationMembershipRepository organizationMemberships = mock(OrganizationMembershipRepository.class);
        SiteMembershipRepository siteMemberships = mock(SiteMembershipRepository.class);

        Organization organization = Organization.builder().id(1L).code("org-a").name("Org A").build();
        Site site = Site.builder().id(2L).organization(organization).code("site-a").name("Site A").build();
        Space space = Space.builder().id(3L).site(site).path("/operations").name("Operations").build();
        Map<String, AppUser> identities = Map.of(
                "subject-1", AppUser.builder().id(4L).subject("subject-1").username("owner").enabled(true).build(),
                "admin-subject", AppUser.builder().id(5L).subject("admin-subject").username("admin").enabled(true).build(),
                "operator-subject", AppUser.builder().id(6L).subject("operator-subject").username("operator").enabled(true).build(),
                "viewer-subject", AppUser.builder().id(7L).subject("viewer-subject").username("viewer").enabled(true).build()
        );
        when(organizations.findByCode("org-a")).thenReturn(Optional.of(organization));
        when(sites.findByOrganizationAndCode(organization, "site-a")).thenReturn(Optional.of(site));
        when(spaces.findBySiteAndPath(site, "/operations")).thenReturn(Optional.of(space));
        when(users.findBySubject(anyString())).thenAnswer(invocation -> Optional.ofNullable(identities.get(invocation.getArgument(0))));
        when(organizationMemberships.existsByUserIdAndOrganizationId(4L, 1L)).thenReturn(false);
        when(siteMemberships.existsByUserIdAndSiteId(any(), any())).thenReturn(false);

        service(properties, users, organizations, sites, spaces, organizationMemberships, siteMemberships).provisionOwner();

        verify(organizationMemberships, times(1)).save(any());
        ArgumentCaptor<com.iot.manager.entity.SiteMembership> memberships = ArgumentCaptor.forClass(com.iot.manager.entity.SiteMembership.class);
        verify(siteMemberships, times(4)).save(memberships.capture());
        assertThat(memberships.getAllValues())
                .extracting(value -> value.getUser().getSubject())
                .containsExactlyInAnyOrder("subject-1", "admin-subject", "operator-subject", "viewer-subject");
    }

    @Test
    void failsClosedWhenIntegrationIdentityConfigurationIsIncomplete() {
        BootstrapOwnerProperties properties = validProperties();
        properties.setIntegrationIdentitiesEnabled(true);
        properties.setAdminSubject("admin-subject");

        assertThatThrownBy(() -> service(
                properties,
                mock(AppUserRepository.class), mock(OrganizationRepository.class), mock(SiteRepository.class),
                mock(SpaceRepository.class), mock(OrganizationMembershipRepository.class), mock(SiteMembershipRepository.class)
        ).provisionOwner()).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("admin-username");
    }

    @Test
    void doesNotCreateDuplicateMembershipsWhenIntegrationBootstrapRunsAgain() {
        BootstrapOwnerProperties properties = validProperties();
        configureIntegrationIdentities(properties);
        AppUserRepository users = mock(AppUserRepository.class);
        OrganizationRepository organizations = mock(OrganizationRepository.class);
        SiteRepository sites = mock(SiteRepository.class);
        SpaceRepository spaces = mock(SpaceRepository.class);
        OrganizationMembershipRepository organizationMemberships = mock(OrganizationMembershipRepository.class);
        SiteMembershipRepository siteMemberships = mock(SiteMembershipRepository.class);

        Organization organization = Organization.builder().id(1L).code("org-a").name("Org A").build();
        Site site = Site.builder().id(2L).organization(organization).code("site-a").name("Site A").build();
        Space space = Space.builder().id(3L).site(site).path("/operations").name("Operations").build();
        Map<String, AppUser> identities = Map.of(
                "subject-1", AppUser.builder().id(4L).subject("subject-1").username("owner").enabled(true).build(),
                "admin-subject", AppUser.builder().id(5L).subject("admin-subject").username("admin").enabled(true).build(),
                "operator-subject", AppUser.builder().id(6L).subject("operator-subject").username("operator").enabled(true).build(),
                "viewer-subject", AppUser.builder().id(7L).subject("viewer-subject").username("viewer").enabled(true).build()
        );
        when(organizations.findByCode("org-a")).thenReturn(Optional.of(organization));
        when(sites.findByOrganizationAndCode(organization, "site-a")).thenReturn(Optional.of(site));
        when(spaces.findBySiteAndPath(site, "/operations")).thenReturn(Optional.of(space));
        when(users.findBySubject(anyString())).thenAnswer(invocation -> Optional.ofNullable(identities.get(invocation.getArgument(0))));
        when(organizationMemberships.existsByUserIdAndOrganizationId(4L, 1L)).thenReturn(true);
        when(siteMemberships.existsByUserIdAndSiteId(any(), any())).thenReturn(true);

        service(properties, users, organizations, sites, spaces, organizationMemberships, siteMemberships).provisionOwner();

        verify(users, never()).save(any());
        verify(organizationMemberships, never()).save(any());
        verify(siteMemberships, never()).save(any());
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

    private void configureIntegrationIdentities(BootstrapOwnerProperties properties) {
        properties.setIntegrationIdentitiesEnabled(true);
        properties.setAdminSubject("admin-subject");
        properties.setAdminUsername("admin");
        properties.setAdminDisplayName("Admin");
        properties.setAdminEmail("admin@example.invalid");
        properties.setOperatorSubject("operator-subject");
        properties.setOperatorUsername("operator");
        properties.setOperatorDisplayName("Operator");
        properties.setOperatorEmail("operator@example.invalid");
        properties.setViewerSubject("viewer-subject");
        properties.setViewerUsername("viewer");
        properties.setViewerDisplayName("Viewer");
        properties.setViewerEmail("viewer@example.invalid");
    }
}
