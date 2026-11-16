package com.iot.manager.weather;

import tools.jackson.databind.ObjectMapper;
import com.iot.manager.dto.SiteWeatherSettingsRequest;
import com.iot.manager.dto.SiteWeatherLocationRequest;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceProfile;
import com.iot.manager.entity.DeviceTelemetrySample;
import com.iot.manager.entity.ObservedTimeTrust;
import com.iot.manager.entity.SiteWeatherSettings;
import com.iot.manager.entity.SiteWeatherSnapshot;
import com.iot.manager.entity.WeatherProviderAccessEvent;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.DeviceProfileRepository;
import com.iot.manager.repository.DeviceTelemetrySampleRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SiteWeatherForecastPointRepository;
import com.iot.manager.repository.SiteWeatherSettingsRepository;
import com.iot.manager.repository.SiteWeatherSnapshotRepository;
import com.iot.manager.repository.WeatherProviderAccessEventRepository;
import com.iot.manager.service.WebSocketService;
import com.iot.manager.service.PlatformMetricsService;
import com.iot.manager.service.TimeProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.time.Instant;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.NoSuchElementException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SiteWeatherServiceTest {

    @Mock private SiteRepository siteRepository;
    @Mock private DeviceRepository deviceRepository;
    @Mock private DeviceProfileRepository deviceProfileRepository;
    @Mock private DeviceTelemetrySampleRepository telemetrySampleRepository;
    @Mock private SiteWeatherSettingsRepository settingsRepository;
    @Mock private SiteWeatherSnapshotRepository snapshotRepository;
    @Mock private SiteWeatherForecastPointRepository forecastRepository;
    @Mock private WeatherProviderAccessEventRepository weatherProviderAccessEventRepository;
    @Mock private WebSocketService webSocketService;
    @Mock private PlatformMetricsService platformMetricsService;

    @Test
    void returnsPendingWhenTheActiveConfigurationHasNoMatchingSnapshot() {
        Site site = Site.builder().id(7L).code("demo-site").build();
        SiteWeatherSettings settings = settings(site, 22.5431, 114.0579);
        when(siteRepository.findFirstByCode("demo-site")).thenReturn(Optional.of(site));
        when(settingsRepository.findBySiteId(7L)).thenReturn(Optional.of(settings));
        when(snapshotRepository.findTopBySiteIdAndConfigurationFingerprintOrderByFetchedAtDesc(eq(7L), anyString()))
                .thenReturn(Optional.empty());

        var weather = service().current("demo-site");

        assertThat(weather.status()).isEqualTo("PENDING");
        assertThat(weather.current()).isNull();
        verify(snapshotRepository).findTopBySiteIdAndConfigurationFingerprintOrderByFetchedAtDesc(eq(7L), anyString());
    }

    @Test
    void coordinateChangeClearsActiveForecastAndLeavesTheSitePendingUntilRefresh() {
        Site site = Site.builder().id(7L).code("demo-site").build();
        SiteWeatherSettings settings = settings(site, 22.5431, 114.0579);
        when(siteRepository.findFirstByCode("demo-site")).thenReturn(Optional.of(site));
        when(settingsRepository.findBySiteId(7L)).thenReturn(Optional.of(settings));
        when(settingsRepository.save(settings)).thenReturn(settings);
        when(snapshotRepository.findTopBySiteIdAndConfigurationFingerprintOrderByFetchedAtDesc(eq(7L), anyString()))
                .thenReturn(Optional.empty());

        var result = service().updateSettings("demo-site", new SiteWeatherSettingsRequest(
                true, null, 39.9042, 116.4074, "Asia/Shanghai", 44D, null, null
        ));

        assertThat(result.lastFetchedAt()).isNull();
        verify(forecastRepository).deleteBySiteId(7L);
        ArgumentCaptor<String> fingerprint = ArgumentCaptor.forClass(String.class);
        verify(snapshotRepository).findTopBySiteIdAndConfigurationFingerprintOrderByFetchedAtDesc(eq(7L), fingerprint.capture());
        assertThat(fingerprint.getValue()).startsWith("v2:").doesNotContain("39.9042", "116.4074");
    }

    @Test
    void mobileLocationPersistsItsSourceAndRefreshesRealWeatherWithoutAStaleElevationOverride() {
        Site site = Site.builder().id(7L).code("demo-site").build();
        SiteWeatherSettings settings = settings(site, 22.5431, 114.0579);
        settings.setManualElevationM(32D);
        when(siteRepository.findFirstByCode("demo-site")).thenReturn(Optional.of(site));
        when(settingsRepository.findBySiteId(7L)).thenReturn(Optional.of(settings));
        when(settingsRepository.save(settings)).thenReturn(settings);
        when(snapshotRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        WeatherProvider provider = new WeatherProvider() {
            @Override
            public boolean supports(String providerCode) {
                return "OPEN_METEO".equals(providerCode);
            }

            @Override
            public WeatherPayload fetch(SiteWeatherSettings updated) {
                assertThat(updated.getLatitude()).isEqualTo(39.9042);
                assertThat(updated.getLongitude()).isEqualTo(116.4074);
                return new WeatherPayload("OPEN_METEO", Instant.parse("2026-08-13T06:00:00Z"), 52D,
                        new WeatherPayload.Current(1, 24D, 24D, 50, 1000D, 5D, 90),
                        List.of(), List.of(), "{\"latitude\":39.9042,\"longitude\":116.4074,\"timezone\":\"Asia/Shanghai\"}");
            }
        };

        var weather = service(List.of(provider)).updateLocationAndRefresh("demo-site", new SiteWeatherLocationRequest(
                39.9042, 116.4074, 16D, "Asia/Shanghai", "MOBILE_GPS"
        ));

        assertThat(settings.getLocationSource()).isEqualTo("MOBILE_GPS");
        assertThat(settings.getLocationAccuracyM()).isEqualTo(16D);
        assertThat(settings.getManualElevationM()).isNull();
        assertThat(weather.current().elevationM()).isEqualTo(52D);
        assertThat(weather.current().elevationSource()).isEqualTo("PROVIDER");
        verify(forecastRepository, times(2)).deleteBySiteId(7L);
        ArgumentCaptor<SiteWeatherSnapshot> snapshot = ArgumentCaptor.forClass(SiteWeatherSnapshot.class);
        verify(snapshotRepository).save(snapshot.capture());
        assertThat(snapshot.getValue().getRawPayloadJson()).doesNotContain("latitude", "longitude");
        ArgumentCaptor<WeatherProviderAccessEvent> audit = ArgumentCaptor.forClass(WeatherProviderAccessEvent.class);
        verify(weatherProviderAccessEventRepository).save(audit.capture());
        assertThat(audit.getValue().getPurpose()).isEqualTo("WEATHER_REFRESH");
        assertThat(audit.getValue().getOutcome()).isEqualTo("SUCCESS");
        assertThat(audit.getValue().getCoordinatePrecision()).isEqualTo("EXACT");
    }

    @Test
    void locationIsPersistedAndMarkedPendingWhenTheWeatherProviderIsTemporarilyUnavailable() {
        Site site = Site.builder().id(7L).code("demo-site").build();
        SiteWeatherSettings settings = settings(site, 22.5431, 114.0579);
        when(siteRepository.findFirstByCode("demo-site")).thenReturn(Optional.of(site));
        when(settingsRepository.findBySiteId(7L)).thenReturn(Optional.of(settings));
        when(settingsRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        WeatherProvider unavailableProvider = new WeatherProvider() {
            @Override
            public boolean supports(String providerCode) {
                return "OPEN_METEO".equals(providerCode);
            }

            @Override
            public WeatherPayload fetch(SiteWeatherSettings ignored) {
                throw new WeatherProviderException("upstream timeout");
            }
        };

        var weather = service(List.of(unavailableProvider)).updateLocationAndRefresh("demo-site", new SiteWeatherLocationRequest(
                39.9042, 116.4074, 22D, "Asia/Shanghai", "MOBILE_GPS"
        ));

        assertThat(settings.getLatitude()).isEqualTo(39.9042);
        assertThat(settings.getLongitude()).isEqualTo(116.4074);
        assertThat(settings.getLocationSource()).isEqualTo("MOBILE_GPS");
        assertThat(settings.getWeatherRetryCount()).isEqualTo(1);
        assertThat(settings.getRetryAfter()).isAfter(Instant.now().minusSeconds(1));
        assertThat(weather.status()).isEqualTo("PENDING");
        assertThat(weather.refreshError()).contains("30 秒后自动重试");
        ArgumentCaptor<WeatherProviderAccessEvent> audit = ArgumentCaptor.forClass(WeatherProviderAccessEvent.class);
        verify(weatherProviderAccessEventRepository).save(audit.capture());
        assertThat(audit.getValue().getOutcome()).isEqualTo("FAILURE");
        assertThat(audit.getValue().getErrorCode()).isEqualTo("PROVIDER_ERROR");
    }

    @Test
    void repeatedManualRefreshIsRateLimitedBeforeCallingAProvider() {
        Site site = Site.builder().id(7L).code("demo-site").build();
        SiteWeatherSettings settings = settings(site, 22.5431, 114.0579);
        settings.setLastManualRefreshAt(Instant.now());
        when(siteRepository.findFirstByCode("demo-site")).thenReturn(Optional.of(site));
        when(settingsRepository.findBySiteId(7L)).thenReturn(Optional.of(settings));

        WeatherRefreshRateLimitedException exception = assertThrows(
                WeatherRefreshRateLimitedException.class, () -> service().refresh("demo-site")
        );

        assertThat(exception).hasMessageContaining("秒后再试");
        assertThat(exception.getRemainingSeconds()).isGreaterThan(0L).isLessThanOrEqualTo(60L);
    }

    @ParameterizedTest
    @ValueSource(strings = {"foreign-site", "archived", "missing"})
    void rejectsUnauthorizedTemperatureSourceBeforeMutatingSettings(String scenario) {
        Site site = Site.builder().id(7L).code("site-a").build();
        Device device = temperatureDevice(site);
        if ("foreign-site".equals(scenario)) device.setSite(Site.builder().id(99L).code("site-b").build());
        if ("archived".equals(scenario)) device.setArchivedAt(LocalDateTime.of(2026, 11, 16, 12, 0));
        when(deviceRepository.findById(8L)).thenReturn("missing".equals(scenario) ? Optional.empty() : Optional.of(device));

        assertThrows(NoSuchElementException.class, () -> service().updateSettings(site, temperatureRequest(null)));

        verifyNoInteractions(settingsRepository, telemetrySampleRepository, deviceProfileRepository);
    }

    @ParameterizedTest
    @ValueSource(strings = {"humidity", "wrong-unit", "boolean", "missing-profile", "disabled-profile", "malformed-profile"})
    void rejectsFieldsWithoutCelsiusTemperatureCapability(String scenario) {
        Site site = Site.builder().id(7L).code("site-a").build();
        when(deviceRepository.findById(8L)).thenReturn(Optional.of(temperatureDevice(site)));
        DeviceProfile profile = temperatureProfile();
        String field = "temperature";
        switch (scenario) {
            case "humidity" -> field = "humidity";
            case "wrong-unit" -> profile.setDefinitionJson("{\"telemetry\":[{\"id\":\"temperature\",\"type\":\"number\",\"unit\":\"F\"}]}");
            case "boolean" -> profile.setDefinitionJson("{\"telemetry\":[{\"id\":\"temperature\",\"type\":\"boolean\",\"unit\":\"C\"}]}");
            case "disabled-profile" -> profile.setEnabled(false);
            case "malformed-profile" -> profile.setDefinitionJson("{");
            default -> { }
        }
        when(deviceProfileRepository.findByProfileIdAndProfileVersion("temperature-v1", 1))
                .thenReturn("missing-profile".equals(scenario) ? Optional.empty() : Optional.of(profile));
        String selectedField = field;

        assertThrows(IllegalArgumentException.class, () -> service().updateSettings(site, temperatureRequest(selectedField)));
        verifyNoInteractions(settingsRepository, telemetrySampleRepository);
    }

    @ParameterizedTest
    @ValueSource(strings = {"temperature", "surfaceTemperature"})
    void acceptsSameSiteCelsiusSourceAndDefaultsItsField(String field) {
        Site site = Site.builder().id(7L).code("site-a").build();
        Device device = temperatureDevice(site);
        when(deviceRepository.findById(8L)).thenReturn(Optional.of(device));
        DeviceProfile profile = temperatureProfile();
        if ("surfaceTemperature".equals(field)) {
            profile.setDefinitionJson(profile.getDefinitionJson().replace("\"temperature\"", "\"surfaceTemperature\"").replace("\"C\"", "\"°C\""));
        }
        when(deviceProfileRepository.findByProfileIdAndProfileVersion("temperature-v1", 1)).thenReturn(Optional.of(profile));
        when(settingsRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = service().updateSettings(site, temperatureRequest("temperature".equals(field) ? null : field));

        assertThat(result.condensationTemperatureDeviceId()).isEqualTo(8L);
        assertThat(result.condensationTemperatureField()).isEqualTo(field);
    }

    @ParameterizedTest
    @ValueSource(strings = {"foreign-site", "archived"})
    void persistedInvalidAssociationIsHiddenAndNeverRead(String scenario) {
        Site site = Site.builder().id(7L).code("site-a").build();
        SiteWeatherSettings setting = settings(site, 22.5, 114.0);
        Device device = temperatureDevice(site);
        if ("foreign-site".equals(scenario)) device.setSite(Site.builder().id(99L).code("site-b").build());
        else device.setArchivedAt(LocalDateTime.of(2026, 11, 16, 12, 0));
        setting.setCondensationTemperatureDevice(device);
        setting.setCondensationTemperatureField("temperature");
        when(settingsRepository.findBySiteId(7L)).thenReturn(Optional.of(setting));
        when(snapshotRepository.findTopBySiteIdAndConfigurationFingerprintOrderByFetchedAtDesc(eq(7L), anyString()))
                .thenReturn(Optional.of(snapshot()));
        SiteWeatherService service = fixedTimeService();

        assertThat(service.settings(site).condensationTemperatureDeviceId()).isNull();
        assertThat(service.settings(site).condensationTemperatureField()).isNull();
        assertThat(service.current(site).indicators().condensationRisk().level()).isEqualTo("UNAVAILABLE");
        verifyNoInteractions(telemetrySampleRepository, deviceProfileRepository);
    }

    @ParameterizedTest
    @ValueSource(strings = {"fresh", "fresh-risk", "custom-field", "exact-five-minutes", "server-time-only", "warning", "stale", "future-receipt",
            "future-observation", "skewed", "legacy-trust", "missing-trust", "unknown-with-observation", "missing-sample",
            "missing-receipt", "missing-field", "string-value", "non-finite", "invalid-json", "offline", "expired-weather", "retired-profile"})
    void condensationUsesOnlyRecentUsableTelemetryAndNeverTheDeviceDefault(String scenario) {
        Site site = Site.builder().id(7L).code("site-a").build();
        Device device = temperatureDevice(site);
        // If this default were used, the margin would be dangerously below dew point.
        device.setTemperature(-100D);
        SiteWeatherSettings setting = settings(site, 22.5, 114.0);
        setting.setCondensationTemperatureDevice(device);
        when(settingsRepository.findBySiteId(7L)).thenReturn(Optional.of(setting));
        SiteWeatherSnapshot weatherSnapshot = snapshot();
        if ("expired-weather".equals(scenario)) weatherSnapshot.setFetchedAt(NOW.minusSeconds(7 * 60 * 60));
        when(snapshotRepository.findTopBySiteIdAndConfigurationFingerprintOrderByFetchedAtDesc(eq(7L), anyString()))
                .thenReturn(Optional.of(weatherSnapshot));
        DeviceProfile profile = temperatureProfile();
        if ("retired-profile".equals(scenario)) profile.setEnabled(false);
        if ("custom-field".equals(scenario)) {
            setting.setCondensationTemperatureField("surfaceTemperature");
            profile.setDefinitionJson(profile.getDefinitionJson().replace("\"temperature\"", "\"surfaceTemperature\""));
        }
        when(deviceProfileRepository.findByProfileIdAndProfileVersion("temperature-v1", 1)).thenReturn(Optional.of(profile));
        DeviceTelemetrySample sample = DeviceTelemetrySample.builder().device(device).receivedAt(NOW.minusSeconds(30))
                .observedAt(NOW.minusSeconds(30)).observedTimeTrust(ObservedTimeTrust.TRUSTED)
                .sampledAt(LocalDateTime.of(2099, 1, 1, 0, 0)).stateJson("{\"temperature\":24}").build();
        switch (scenario) {
            case "fresh-risk" -> sample.setStateJson("{\"temperature\":0}");
            case "custom-field" -> sample.setStateJson("{\"surfaceTemperature\":24}");
            case "exact-five-minutes" -> { sample.setReceivedAt(NOW.minusSeconds(300)); sample.setObservedAt(NOW.minusSeconds(300)); }
            case "server-time-only" -> { sample.setObservedAt(null); sample.setObservedTimeTrust(ObservedTimeTrust.UNKNOWN); }
            case "warning" -> device.setStatus("WARNING");
            case "stale" -> sample.setReceivedAt(NOW.minusSeconds(301));
            case "future-receipt" -> sample.setReceivedAt(NOW.plusSeconds(1));
            case "future-observation" -> sample.setObservedAt(NOW.plusSeconds(1));
            case "skewed" -> sample.setObservedTimeTrust(ObservedTimeTrust.SKEWED);
            case "legacy-trust" -> sample.setObservedTimeTrust(ObservedTimeTrust.LEGACY_UNKNOWN);
            case "missing-trust" -> sample.setObservedTimeTrust(null);
            case "unknown-with-observation" -> sample.setObservedTimeTrust(ObservedTimeTrust.UNKNOWN);
            case "missing-receipt" -> sample.setReceivedAt(null);
            case "missing-field" -> sample.setStateJson("{\"humidity\":50}");
            case "string-value" -> sample.setStateJson("{\"temperature\":\"24\"}");
            case "non-finite" -> sample.setStateJson("{\"temperature\":1e999}");
            case "invalid-json" -> sample.setStateJson("{");
            case "offline" -> device.setStatus("OFFLINE");
            default -> { }
        }
        if (!List.of("offline", "retired-profile").contains(scenario)) {
            when(telemetrySampleRepository.findTopByDeviceIdAndReceivedAtIsNotNullOrderByReceivedAtDesc(8L))
                    .thenReturn("missing-sample".equals(scenario) ? Optional.empty() : Optional.of(sample));
        }

        var indicator = fixedTimeService().current(site).indicators().condensationRisk();

        boolean valid = List.of("fresh", "custom-field", "exact-five-minutes", "server-time-only", "warning").contains(scenario);
        assertThat(indicator.level()).isEqualTo("fresh-risk".equals(scenario) ? "RISK" : valid ? "SUITABLE" : "UNAVAILABLE");
        verify(telemetrySampleRepository, never()).findTopByDeviceIdOrderBySampledAtDesc(any());
    }

    private static final Instant NOW = Instant.parse("2026-11-16T15:00:00Z");

    private Device temperatureDevice(Site site) {
        return Device.builder().id(8L).site(site).profileId("temperature-v1").profileVersion(1).status("ONLINE").build();
    }

    private DeviceProfile temperatureProfile() {
        return DeviceProfile.builder().enabled(true).definitionJson("{\"telemetry\":["
                + "{\"id\":\"temperature\",\"type\":\"number\",\"unit\":\"C\"},"
                + "{\"id\":\"humidity\",\"type\":\"number\",\"unit\":\"%\"}]}").build();
    }

    private SiteWeatherSettingsRequest temperatureRequest(String field) {
        return new SiteWeatherSettingsRequest(true, null, 22.5, 114.0, "Asia/Shanghai", null, 8L, field);
    }

    private SiteWeatherSnapshot snapshot() {
        return SiteWeatherSnapshot.builder().fetchedAt(NOW).weatherCode(0).temperatureC(24D)
                .relativeHumidityPct(50).surfacePressureHpa(1000D).build();
    }

    private SiteWeatherService fixedTimeService() {
        return service(List.of(), Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private SiteWeatherService service() {
        return service(List.of());
    }

    private SiteWeatherService service(List<WeatherProvider> providers) {
        return service(providers, Clock.systemUTC());
    }

    private SiteWeatherService service(List<WeatherProvider> providers, Clock clock) {
        return new SiteWeatherService(
                siteRepository, deviceRepository, deviceProfileRepository, telemetrySampleRepository, settingsRepository, snapshotRepository,
                forecastRepository, weatherProviderAccessEventRepository, providers, new WeatherCodeMapper(),
                new EnvironmentStatusEvaluator(new DewPointCalculator(), new WeatherEnvironmentRules()),
                webSocketService, platformMetricsService, new TimeProvider(clock, new com.iot.manager.config.TimeProperties()), new ObjectMapper(), weatherPrivacyProperties()
        );
    }

    private WeatherPrivacyProperties weatherPrivacyProperties() {
        WeatherPrivacyProperties properties = new WeatherPrivacyProperties();
        properties.setFingerprintSecret("test-weather-fingerprint-secret");
        return properties;
    }

    private SiteWeatherSettings settings(Site site, double latitude, double longitude) {
        return SiteWeatherSettings.builder()
                .site(site).enabled(true).providerCode("OPEN_METEO")
                .latitude(latitude).longitude(longitude).timezone("Asia/Shanghai")
                .build();
    }
}
