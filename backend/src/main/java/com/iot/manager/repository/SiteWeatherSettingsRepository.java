package com.iot.manager.repository;

import com.iot.manager.entity.SiteWeatherSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface SiteWeatherSettingsRepository extends JpaRepository<SiteWeatherSettings, Long> {

    Optional<SiteWeatherSettings> findBySiteId(Long siteId);

    List<SiteWeatherSettings> findByEnabledTrue();

    List<SiteWeatherSettings> findByEnabledTrueAndRetryAfterLessThanEqual(Instant retryAfter);
}
