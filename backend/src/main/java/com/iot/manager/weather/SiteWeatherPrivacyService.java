package com.iot.manager.weather;

import com.iot.manager.entity.SiteWeatherSettings;
import com.iot.manager.repository.SiteWeatherForecastPointRepository;
import com.iot.manager.repository.SiteWeatherSettingsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;

/** Enforces the documented 30-day precision-retention policy for site weather. */
@Service
@RequiredArgsConstructor
public class SiteWeatherPrivacyService {

    static final Duration PRECISE_LOCATION_RETENTION = Duration.ofDays(30);
    private static final String COARSENED_SOURCE = "COARSENED";
    private static final double MINIMUM_COARSE_ACCURACY_METERS = 1_000D;

    private final SiteWeatherSettingsRepository settingsRepository;
    private final SiteWeatherForecastPointRepository forecastRepository;

    @Transactional
    public int coarsenExpiredLocations(Instant now) {
        Instant cutoff = now.minus(PRECISE_LOCATION_RETENTION);
        int changed = 0;
        for (SiteWeatherSettings setting : settingsRepository
                .findByLocationUpdatedAtBeforeAndLatitudeIsNotNullAndLongitudeIsNotNull(cutoff)) {
            if (COARSENED_SOURCE.equalsIgnoreCase(setting.getLocationSource())) continue;
            double coarseLatitude = roundToTwoDecimals(setting.getLatitude());
            double coarseLongitude = roundToTwoDecimals(setting.getLongitude());
            boolean coordinatesChanged = Double.compare(coarseLatitude, setting.getLatitude()) != 0
                    || Double.compare(coarseLongitude, setting.getLongitude()) != 0;
            setting.setLatitude(coarseLatitude);
            setting.setLongitude(coarseLongitude);
            setting.setLocationSource(COARSENED_SOURCE);
            setting.setLocationAccuracyM(Math.max(
                    setting.getLocationAccuracyM() == null ? 0D : setting.getLocationAccuracyM(),
                    MINIMUM_COARSE_ACCURACY_METERS
            ));
            settingsRepository.save(setting);
            if (coordinatesChanged) {
                forecastRepository.deleteBySiteId(setting.getSite().getId());
            }
            changed++;
        }
        return changed;
    }

    private double roundToTwoDecimals(double value) {
        return Math.round(value * 100D) / 100D;
    }
}
