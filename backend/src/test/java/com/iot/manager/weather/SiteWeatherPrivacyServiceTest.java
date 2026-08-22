package com.iot.manager.weather;

import com.iot.manager.entity.Site;
import com.iot.manager.entity.SiteWeatherSettings;
import com.iot.manager.repository.SiteWeatherForecastPointRepository;
import com.iot.manager.repository.SiteWeatherSettingsRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SiteWeatherPrivacyServiceTest {

    @Mock private SiteWeatherSettingsRepository settingsRepository;
    @Mock private SiteWeatherForecastPointRepository forecastRepository;

    @Test
    void coarsensExpiredPreciseLocationAndInvalidatesItsForecast() {
        Site site = Site.builder().id(7L).code("demo-site").build();
        SiteWeatherSettings setting = SiteWeatherSettings.builder()
                .site(site)
                .latitude(22.54314)
                .longitude(114.05791)
                .locationSource("MOBILE_GPS")
                .locationAccuracyM(12D)
                .locationUpdatedAt(Instant.parse("2026-01-01T00:00:00Z"))
                .build();
        Instant now = Instant.parse("2026-02-15T00:00:00Z");
        when(settingsRepository.findByLocationUpdatedAtBeforeAndLatitudeIsNotNullAndLongitudeIsNotNull(
                now.minus(SiteWeatherPrivacyService.PRECISE_LOCATION_RETENTION)
        )).thenReturn(List.of(setting));

        int changed = new SiteWeatherPrivacyService(settingsRepository, forecastRepository).coarsenExpiredLocations(now);

        assertThat(changed).isEqualTo(1);
        assertThat(setting.getLatitude()).isEqualTo(22.54D);
        assertThat(setting.getLongitude()).isEqualTo(114.06D);
        assertThat(setting.getLocationSource()).isEqualTo("COARSENED");
        assertThat(setting.getLocationAccuracyM()).isEqualTo(1_000D);
        verify(settingsRepository).save(setting);
        verify(forecastRepository).deleteBySiteId(7L);
    }

    @Test
    void alreadyCoarsenedLocationIsNotChangedAgain() {
        SiteWeatherSettings setting = SiteWeatherSettings.builder()
                .site(Site.builder().id(7L).code("demo-site").build())
                .latitude(22.54D)
                .longitude(114.06D)
                .locationSource("COARSENED")
                .locationUpdatedAt(Instant.parse("2026-01-01T00:00:00Z"))
                .build();
        Instant now = Instant.parse("2026-02-15T00:00:00Z");
        when(settingsRepository.findByLocationUpdatedAtBeforeAndLatitudeIsNotNullAndLongitudeIsNotNull(
                now.minus(SiteWeatherPrivacyService.PRECISE_LOCATION_RETENTION)
        )).thenReturn(List.of(setting));

        int changed = new SiteWeatherPrivacyService(settingsRepository, forecastRepository).coarsenExpiredLocations(now);

        assertThat(changed).isZero();
        verify(settingsRepository, never()).save(setting);
        verify(forecastRepository, never()).deleteBySiteId(7L);
    }
}
