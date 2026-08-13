package com.iot.manager.repository;

import com.iot.manager.entity.SiteWeatherSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SiteWeatherSnapshotRepository extends JpaRepository<SiteWeatherSnapshot, Long> {

    Optional<SiteWeatherSnapshot> findTopBySiteIdAndConfigurationFingerprintOrderByFetchedAtDesc(
            Long siteId, String configurationFingerprint
    );
}
