package com.iot.manager.service;

import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SpaceRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class BootstrapServiceTest {

    @Autowired
    private OrganizationRepository organizationRepository;

    @Autowired
    private SiteRepository siteRepository;

    @Autowired
    private SpaceRepository spaceRepository;

    @Autowired
    private BootstrapService bootstrapService;

    @Test
    void ensureDemoContextCreatesOneDemoHierarchyIdempotently() {
        var fieldSpace = bootstrapService.ensureDemoContext();
        bootstrapService.ensureDemoContext();

        assertThat(fieldSpace.getPath()).isEqualTo("/operations/field");

        var organization = organizationRepository.findByCode("demo-org");
        assertThat(organization).isPresent();

        var site = siteRepository.findByOrganizationAndCode(organization.orElseThrow(), "demo-site");
        assertThat(site).isPresent();

        assertThat(spaceRepository.findBySiteAndPath(site.orElseThrow(), "/operations")).isPresent();
        assertThat(spaceRepository.findBySiteAndPath(site.orElseThrow(), "/operations/field")).isPresent();
        assertThat(organizationRepository.count()).isEqualTo(1);
        assertThat(siteRepository.count()).isEqualTo(1);
        assertThat(spaceRepository.count()).isEqualTo(2);
    }
}
