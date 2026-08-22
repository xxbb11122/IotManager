package com.iot.manager.weather;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(value = "iot.weather.scheduler-enabled", havingValue = "true", matchIfMissing = true)
public class SiteWeatherScheduler {

    private final SiteWeatherService siteWeatherService;

    @Scheduled(
            fixedDelayString = "${iot.weather.refresh-interval-ms:1800000}",
            initialDelayString = "${iot.weather.initial-delay-ms:30000}"
    )
    public void refreshEnabledSites() {
        for (Long siteId : siteWeatherService.enabledSiteIds()) {
            try {
                siteWeatherService.refreshSiteById(siteId);
            } catch (WeatherRefreshInProgressException ignored) {
                // A manual refresh already owns the site; the next cycle will retry.
            } catch (RuntimeException exception) {
                log.warn("Weather refresh failed for site {}: {}", siteId, exception.getMessage());
            }
        }
    }

    /**
     * A failed refresh gets exactly one short retry. Normal polling remains at
     * thirty minutes, so an upstream outage cannot create a request storm.
     */
    @Scheduled(
            fixedDelayString = "${iot.weather.retry-check-interval-ms:30000}",
            initialDelayString = "${iot.weather.retry-initial-delay-ms:30000}"
    )
    public void retryFailedSites() {
        for (Long siteId : siteWeatherService.retryDueSiteIds()) {
            try {
                siteWeatherService.retrySiteById(siteId);
            } catch (WeatherRefreshInProgressException ignored) {
                // The active request owns the site. The next short check can retry it.
            } catch (RuntimeException exception) {
                log.warn("Weather retry failed for site {}: {}", siteId, exception.getMessage());
            }
        }
    }
}
