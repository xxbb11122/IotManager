package com.iot.manager.weather;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.dto.SiteWeatherSettingsRequest;
import com.iot.manager.dto.SiteWeatherLocationRequest;
import com.iot.manager.entity.Site;
import com.iot.manager.entity.SiteWeatherSettings;
import com.iot.manager.entity.SiteWeatherSnapshot;
import com.iot.manager.entity.WeatherProviderAccessEvent;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.DeviceTelemetrySampleRepository;
import com.iot.manager.repository.SiteRepository;
import com.iot.manager.repository.SiteWeatherForecastPointRepository;
import com.iot.manager.repository.SiteWeatherSettingsRepository;
import com.iot.manager.repository.SiteWeatherSnapshotRepository;
import com.iot.manager.repository.WeatherProviderAccessEventRepository;
import com.iot.manager.service.WebSocketService;
import com.iot.manager.service.PlatformMetricsService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SiteWeatherServiceTest {

    @Mock private SiteRepository siteRepository;
    @Mock private DeviceRepository deviceRepository;
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

        WeatherRefreshRateLimitedException exception = catchThrowableOfType(
                () -> service().refresh("demo-site"), WeatherRefreshRateLimitedException.class
        );

        assertThat(exception).hasMessageContaining("秒后再试");
        assertThat(exception.getRemainingSeconds()).isGreaterThan(0L).isLessThanOrEqualTo(60L);
    }

    private SiteWeatherService service() {
        return service(List.of());
    }

    private SiteWeatherService service(List<WeatherProvider> providers) {
        return new SiteWeatherService(
                siteRepository, deviceRepository, telemetrySampleRepository, settingsRepository, snapshotRepository,
                forecastRepository, weatherProviderAccessEventRepository, providers, new WeatherCodeMapper(),
                new EnvironmentStatusEvaluator(new DewPointCalculator(), new WeatherEnvironmentRules()),
                webSocketService, platformMetricsService, new ObjectMapper(), weatherPrivacyProperties()
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
