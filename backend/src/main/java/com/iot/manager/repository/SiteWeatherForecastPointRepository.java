package com.iot.manager.repository;

import com.iot.manager.entity.SiteWeatherForecastPoint;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface SiteWeatherForecastPointRepository extends JpaRepository<SiteWeatherForecastPoint, Long> {

    List<SiteWeatherForecastPoint> findBySiteIdAndConfigurationFingerprintAndForecastKindOrderByForecastAtAsc(
            Long siteId, String configurationFingerprint, SiteWeatherForecastPoint.Kind forecastKind
    );

    @Transactional
    long deleteBySiteId(Long siteId);

    List<SiteWeatherForecastPoint> findByFetchedAtLessThanOrderByFetchedAtAsc(Instant cutoff, org.springframework.data.domain.Pageable pageable);

    @Query("""
            select point from SiteWeatherForecastPoint point
            where point.fetchedAt < :cutoff
              and point.forecastAt < :now
              and (point.fetchedAt > :cursorAt
                   or (point.fetchedAt = :cursorAt and point.id > :cursorId))
            order by point.fetchedAt asc, point.id asc
            """)
    List<SiteWeatherForecastPoint> findRetentionCandidatesAfter(
            @Param("cutoff") Instant cutoff,
            @Param("now") Instant now,
            @Param("cursorAt") Instant cursorAt,
            @Param("cursorId") Long cursorId,
            org.springframework.data.domain.Pageable pageable
    );
}
