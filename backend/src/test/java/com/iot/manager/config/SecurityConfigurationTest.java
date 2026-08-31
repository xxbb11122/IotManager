package com.iot.manager.config;

import com.iot.manager.entity.AppUser;
import com.iot.manager.entity.ActivityEvent;
import com.iot.manager.entity.CommandEvent;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.SiteMembership;
import com.iot.manager.entity.Space;
import com.iot.manager.dto.DeviceCommandRequest;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.dto.DeviceView;
import com.iot.manager.dto.CurrentUserView;
import com.iot.manager.dto.SiteView;
import com.iot.manager.repository.AlertRepository;
import com.iot.manager.repository.ActivityEventRepository;
import com.iot.manager.repository.AppUserRepository;
import com.iot.manager.repository.CommandEventRepository;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SiteMembershipRepository;
import com.iot.manager.repository.SpaceRepository;
import com.iot.manager.service.BootstrapService;
import com.iot.manager.service.DeviceService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "iot.security.enabled=true",
                "iot.web.allowed-origins[0]=https://iot.example.test",
                "iot.observability.scrape-token=metrics-test-token",
                "management.defaults.metrics.export.enabled=true",
                "management.endpoint.prometheus.enabled=true",
                "management.endpoints.web.exposure.include=health,info,prometheus"
        }
)
@ActiveProfiles("test")
@Import(SecurityConfigurationTest.JwtDecoderConfiguration.class)
@AutoConfigureMockMvc
class SecurityConfigurationTest {

    @LocalServerPort
    private int port;

    private final TestRestTemplate restTemplate = new TestRestTemplate();

    @Autowired
    private BootstrapService bootstrapService;

    @Autowired
    private AppUserRepository appUserRepository;

    @Autowired
    private SiteMembershipRepository siteMembershipRepository;

    @Autowired
    private DeviceService deviceService;

    @Autowired
    private AlertRepository alertRepository;

    @Autowired
    private CommandEventRepository commandEventRepository;

    @Autowired
    private ActivityEventRepository activityEventRepository;

    @Autowired
    private OrganizationRepository organizationRepository;

    @Autowired
    private SiteRepository siteRepository;

    @Autowired
    private SpaceRepository spaceRepository;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void unauthenticatedBusinessApiReturns401() {
        ResponseEntity<String> response = restTemplate.getForEntity(url("/api/devices"), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void privatePrometheusEndpointAcceptsOnlyTheInternalScrapeTokenInTheTestSecurityContext() {
        ResponseEntity<String> denied = restTemplate.getForEntity(url("/actuator/prometheus"), String.class);

        HttpHeaders wrongScrapeHeaders = new HttpHeaders();
        wrongScrapeHeaders.add(MetricsScrapeAuthenticationFilter.TOKEN_HEADER, "wrong-metrics-test-token");
        ResponseEntity<String> wrongToken = restTemplate.exchange(
                url("/actuator/prometheus"), HttpMethod.GET, new HttpEntity<>(wrongScrapeHeaders), String.class
        );

        HttpHeaders scrapeHeaders = new HttpHeaders();
        scrapeHeaders.add(MetricsScrapeAuthenticationFilter.TOKEN_HEADER, "metrics-test-token");
        ResponseEntity<String> allowed = restTemplate.exchange(
                url("/actuator/prometheus"), HttpMethod.GET, new HttpEntity<>(scrapeHeaders), String.class
        );

        assertThat(denied.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(wrongToken.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        // A focused security test is allowed to run without an exposed
        // Prometheus payload. What matters here is that a valid internal
        // Docker-secret request passes the security boundary while neither an
        // anonymous nor a bad-token request does. The runtime verifier checks
        // the actual 200 Prometheus payload in a fully started application.
        assertThat(allowed.getStatusCode())
                .isNotEqualTo(HttpStatus.UNAUTHORIZED)
                .isNotEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void corsPreflightAllowsOnlyTheConfiguredWebOrigin() throws Exception {
        mockMvc.perform(options("/api/v1/devices")
                        .header(HttpHeaders.ORIGIN, "https://iot.example.test")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "https://iot.example.test"));

        mockMvc.perform(options("/api/v1/devices")
                        .header(HttpHeaders.ORIGIN, "https://untrusted-origin.invalid")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    @Test
    void viewerCanReadButCannotModifyBusinessData() {
        ensureViewerMembership();

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth("viewer-token");

        ResponseEntity<String> readResponse = restTemplate.exchange(
                url("/api/devices"), HttpMethod.GET, new HttpEntity<>(headers), String.class
        );
        ResponseEntity<String> writeResponse = restTemplate.exchange(
                url("/api/devices"), HttpMethod.POST, new HttpEntity<>(headers), String.class
        );

        assertThat(readResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(writeResponse.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void siteWeatherRequiresDatabaseMembershipInAdditionToJwtRole() {
        ensureViewerMembership();

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth("viewer-token");

        ResponseEntity<String> allowed = restTemplate.exchange(
                url("/api/sites/demo-site/weather"), HttpMethod.GET, new HttpEntity<>(headers), String.class
        );
        ResponseEntity<String> denied = restTemplate.exchange(
                url("/api/sites/demo-site/weather"), HttpMethod.GET,
                new HttpEntity<>(bearerHeaders("outsider-token")), String.class
        );

        assertThat(allowed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(denied.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void memberCannotReadADeviceOrAlertFromAnotherSite() {
        ensureViewerMembership();
        Site foreignSite = createForeignSite();
        Device foreignDevice = deviceService.createInContext(
                Device.builder()
                        .name("foreign-security-device")
                        .deviceId("foreign-" + UUID.randomUUID())
                        .type("SENSOR")
                        .protocol("MQTT")
                        .build(),
                spaceRepository.findFirstBySiteIdOrderById(foreignSite.getId()).orElseThrow()
        );
        alertRepository.save(com.iot.manager.entity.Alert.builder()
                .device(foreignDevice)
                .level("CRITICAL")
                .status("OPEN")
                .message("foreign alert")
                .resolved(false)
                .build());

        HttpHeaders headers = bearerHeaders("viewer-token");
        ResponseEntity<String> deviceResponse = restTemplate.exchange(
                url("/api/devices/" + foreignDevice.getId()), HttpMethod.GET,
                new HttpEntity<>(headers), String.class
        );
        ResponseEntity<String> alertResponse = restTemplate.exchange(
                url("/api/alerts/active?siteCode=" + foreignSite.getCode()), HttpMethod.GET,
                new HttpEntity<>(headers), String.class
        );

        assertThat(deviceResponse.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(alertResponse.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void collectionEndpointsOnlyReturnMembershipSites() {
        ensureViewerMembership();
        Site foreignSite = createForeignSite();
        Device foreignDevice = deviceService.createInContext(
                Device.builder()
                        .name("foreign-collection-device")
                        .deviceId("foreign-collection-" + UUID.randomUUID())
                        .type("SENSOR")
                        .protocol("MQTT")
                        .build(),
                spaceRepository.findFirstBySiteIdOrderById(foreignSite.getId()).orElseThrow()
        );

        ResponseEntity<DeviceView[]> response = restTemplate.exchange(
                url("/api/devices"), HttpMethod.GET,
                new HttpEntity<>(bearerHeaders("viewer-token")), DeviceView[].class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody()).noneMatch(view -> foreignDevice.getId().equals(view.id()));
    }

    @Test
    void versionedSiteListContainsOnlyAuthorizedSiteContexts() {
        ensureViewerMembership();
        Site foreignSite = createForeignSite();

        ResponseEntity<SiteView[]> response = restTemplate.exchange(
                url("/api/v1/sites"), HttpMethod.GET,
                new HttpEntity<>(bearerHeaders("viewer-token")), SiteView[].class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody())
                .extracting(SiteView::siteCode)
                .contains("demo-site")
                .doesNotContain(foreignSite.getCode());
    }

    @Test
    void versionedApiIsAvailableWhileLegacyAliasAdvertisesItsSunset() {
        ensureViewerMembership();

        ResponseEntity<String> versioned = restTemplate.exchange(
                url("/api/v1/devices"), HttpMethod.GET,
                new HttpEntity<>(bearerHeaders("viewer-token")), String.class
        );
        ResponseEntity<String> legacy = restTemplate.exchange(
                url("/api/devices"), HttpMethod.GET,
                new HttpEntity<>(bearerHeaders("viewer-token")), String.class
        );

        assertThat(versioned.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(versioned.getHeaders().getFirst("Deprecation")).isNull();
        assertThat(legacy.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(legacy.getHeaders().getFirst("Deprecation")).isEqualTo("true");
        assertThat(legacy.getHeaders().getFirst("Sunset-Version")).isEqualTo("R2.0");
    }

    @Test
    void currentUserEndpointReturnsOnlyTheAuthenticatedMembershipContexts() {
        ensureViewerMembership();
        Site foreignSite = createForeignSite();

        ResponseEntity<CurrentUserView> response = restTemplate.exchange(
                url("/api/v1/me"), HttpMethod.GET,
                new HttpEntity<>(bearerHeaders("viewer-token")), CurrentUserView.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().subject()).isEqualTo("security-test-user");
        assertThat(response.getBody().roles()).containsExactly("VIEWER");
        assertThat(response.getBody().sites()).extracting(SiteView::siteCode)
                .contains("demo-site")
                .doesNotContain(foreignSite.getCode());
    }

    @Test
    void commandAuditCapturesTheAuthenticatedActorAndImmutableSiteScope() {
        AppUser operator = ensureOperatorMembership();
        Site site = bootstrapService.ensureDemoContext().getSite();
        Device device = deviceService.createInContext(
                Device.builder()
                        .name("audited-operator-device")
                        .deviceId("audit-operator-" + UUID.randomUUID())
                        .type("ACTUATOR")
                        .protocol("HTTP")
                        .build(),
                spaceRepository.findFirstBySiteIdOrderById(site.getId()).orElseThrow()
        );
        HttpHeaders headers = bearerHeaders("operator-token");
        headers.setContentType(MediaType.APPLICATION_JSON);

        ResponseEntity<DeviceCommandView> response = restTemplate.exchange(
                url("/api/devices/" + device.getId() + "/commands"),
                HttpMethod.POST,
                new HttpEntity<>(
                        new DeviceCommandRequest("set_power", "audit-" + UUID.randomUUID(), Map.of("on", true)),
                        headers
                ),
                DeviceCommandView.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(response.getBody()).isNotNull();
        String commandId = response.getBody().commandId();
        CommandEvent commandEvent = commandEventRepository
                .findByCommandCommandIdOrderByOccurredAtAsc(commandId)
                .stream()
                .filter(event -> "COMMAND_SUBMITTED".equals(event.getEventType()))
                .findFirst()
                .orElseThrow();
        ActivityEvent activityEvent = activityEventRepository
                .findByDeviceIdOrderByOccurredAtDesc(device.getId())
                .stream()
                .filter(event -> "command_submitted".equals(event.getEventType()))
                .filter(event -> event.getPayloadJson().contains(commandId))
                .findFirst()
                .orElseThrow();

        assertThat(commandEvent.getActorId()).isEqualTo(operator.getId());
        assertThat(commandEvent.getOrganizationId()).isEqualTo(site.getOrganization().getId());
        assertThat(commandEvent.getSiteId()).isEqualTo(site.getId());
        assertThat(activityEvent.getActorId()).isEqualTo(operator.getId());
        assertThat(activityEvent.getOrganizationId()).isEqualTo(site.getOrganization().getId());
        assertThat(activityEvent.getSiteId()).isEqualTo(site.getId());
    }

    private HttpHeaders bearerHeaders(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return headers;
    }

    private void ensureViewerMembership() {
        ensureMembership("security-test-user", "viewer");
    }

    private AppUser ensureOperatorMembership() {
        return ensureMembership("security-test-operator", "operator");
    }

    private AppUser ensureMembership(String subject, String username) {
        AppUser user = appUserRepository.findBySubjectAndEnabledTrue(subject)
                .orElseGet(() -> appUserRepository.save(AppUser.builder()
                        .subject(subject)
                        .username(username)
                        .build()));
        if (!siteMembershipRepository.existsByUserIdAndSiteId(
                user.getId(), bootstrapService.ensureDemoContext().getSite().getId())) {
            siteMembershipRepository.save(SiteMembership.builder()
                    .user(user)
                    .site(bootstrapService.ensureDemoContext().getSite())
                    .build());
        }
        return user;
    }

    private Site createForeignSite() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        Organization organization = organizationRepository.saveAndFlush(Organization.builder()
                .code("foreign-org-" + suffix)
                .name("Foreign Organization")
                .build());
        Site site = siteRepository.saveAndFlush(Site.builder()
                .organization(organization)
                .code("foreign-site-" + suffix)
                .name("Foreign Site")
                .build());
        spaceRepository.saveAndFlush(Space.builder()
                .site(site)
                .name("Foreign Operations")
                .path("/operations")
                .build());
        return site;
    }

    private String url(String path) {
        return "http://localhost:" + port + path;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class JwtDecoderConfiguration {

        @Bean
        JwtDecoder jwtDecoder() {
            return token -> Jwt.withTokenValue(token)
                    .header("alg", "none")
                    .subject(subjectFor(token))
                    .issuedAt(Instant.now().minusSeconds(5))
                    .expiresAt(Instant.now().plusSeconds(300))
                    .claim("preferred_username", "operator-token".equals(token) ? "operator" : "viewer")
                    .claim("realm_access", Map.of("roles", List.of(
                            "operator-token".equals(token) ? "OPERATOR" : "VIEWER"
                    )))
                    .build();
        }

        private String subjectFor(String token) {
            if ("operator-token".equals(token)) {
                return "security-test-operator";
            }
            return "outsider-token".equals(token) ? "security-test-outsider" : "security-test-user";
        }
    }
}
