package com.iot.manager.weather;

import com.iot.manager.service.ScheduledDatabaseTaskGuard;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;

/** Runs daily and never emits precise coordinates into logs. */
@Component
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(value = "iot.weather.scheduler-enabled", havingValue = "true", matchIfMissing = true)
public class SiteWeatherPrivacyScheduler {

    private final SiteWeatherPrivacyService privacyService;
    private final ScheduledDatabaseTaskGuard scheduledDatabaseTaskGuard;

    @Scheduled(cron = "${iot.weather.privacy-coarsen-cron:0 15 3 * * *}")
    public void coarsenExpiredLocations() {
        scheduledDatabaseTaskGuard.run("weather-location-privacy-coarsen", () -> {
            int changed = privacyService.coarsenExpiredLocations(Instant.now());
            if (changed > 0) {
                log.info("Weather location precision reduced for {} expired site configuration(s)", changed);
            }
        });
    }
}
