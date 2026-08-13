package com.iot.manager.repository;

import com.iot.manager.entity.SiteWeatherForecastPoint;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

public interface SiteWeatherForecastPointRepository extends JpaRepository<SiteWeatherForecastPoint, Long> {

    List<SiteWeatherForecastPoint> findBySiteIdAndConfigurationFingerprintAndForecastKindOrderByForecastAtAsc(
            Long siteId, String configurationFingerprint, SiteWeatherForecastPoint.Kind forecastKind
    );

    @Transactional
    long deleteBySiteId(Long siteId);
}
