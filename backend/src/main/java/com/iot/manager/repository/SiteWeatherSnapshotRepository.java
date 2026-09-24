package com.iot.manager.repository;

import com.iot.manager.entity.SiteWeatherSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.time.Instant;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SiteWeatherSnapshotRepository extends JpaRepository<SiteWeatherSnapshot, Long> {

    Optional<SiteWeatherSnapshot> findTopBySiteIdAndConfigurationFingerprintOrderByFetchedAtDesc(
            Long siteId, String configurationFingerprint
    );

    Optional<SiteWeatherSnapshot> findTopBySiteIdOrderByFetchedAtDescIdDesc(Long siteId);

    List<SiteWeatherSnapshot> findByFetchedAtLessThanOrderByFetchedAtAsc(Instant cutoff, Pageable pageable);

    @Query("""
            select snapshot from SiteWeatherSnapshot snapshot
            where snapshot.fetchedAt < :cutoff
              and (snapshot.fetchedAt > :cursorAt
                   or (snapshot.fetchedAt = :cursorAt and snapshot.id > :cursorId))
            order by snapshot.fetchedAt asc, snapshot.id asc
            """)
    List<SiteWeatherSnapshot> findRetentionCandidatesAfter(
            @Param("cutoff") Instant cutoff,
            @Param("cursorAt") Instant cursorAt,
            @Param("cursorId") Long cursorId,
            Pageable pageable
    );
}
