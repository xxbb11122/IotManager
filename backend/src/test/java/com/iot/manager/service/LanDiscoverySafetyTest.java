package com.iot.manager.service;

import com.iot.manager.dto.ClaimLanDeviceRequest;
import com.iot.manager.repository.DeviceConnectionRepository;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SpaceRepository;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.ObjectMapper;

import java.util.NoSuchElementException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LanDiscoverySafetyTest {
    @Mock private BootstrapService bootstrapService;
    @Mock private OrganizationRepository organizationRepository;
    @Mock private SiteRepository siteRepository;
    @Mock private SpaceRepository spaceRepository;
    @Mock private DeviceService deviceService;
    @Mock private DeviceConnectionRepository connectionRepository;
    @Mock private AuditEventService auditEventService;
    @Mock private DeviceMapper deviceMapper;
    @Mock private WebSocketService webSocketService;
    @Mock private ObjectMapper objectMapper;
    @Mock private SiteAccessService siteAccessService;
    @Spy private MockEnvironment environment = new MockEnvironment();
    @InjectMocks private LanDiscoveryService service;

    @ParameterizedTest
    @ValueSource(strings = {"prod", "dev-prod", "test-prod", "no-profile", "secure-dev", "disabled-dev"})
    void fakeDevicesAreUnavailableOutsideExplicitUnsecuredDevelopment(String scenario) {
        ReflectionTestUtils.setField(service, "demoEnabled", !"disabled-dev".equals(scenario));
        switch (scenario) {
            case "prod" -> environment.setActiveProfiles("prod");
            case "dev-prod" -> environment.setActiveProfiles("dev", "prod");
            case "test-prod" -> environment.setActiveProfiles("test", "prod");
            case "secure-dev" -> {
                environment.setActiveProfiles("dev");
                when(siteAccessService.isScopeEnforced()).thenReturn(true);
            }
            case "disabled-dev" -> environment.setActiveProfiles("dev");
            default -> { }
        }

        assertThat(service.listCandidates("demo-site")).isEmpty();
        assertThatThrownBy(() -> service.claim("lan-demo-sensor-01",
                new ClaimLanDeviceRequest("demo-site", "/operations/field", "Must not be created")))
                .isInstanceOf(NoSuchElementException.class);
        verifyNoInteractions(bootstrapService, organizationRepository, siteRepository, spaceRepository,
                deviceService, connectionRepository, auditEventService, deviceMapper, webSocketService);
    }
}
