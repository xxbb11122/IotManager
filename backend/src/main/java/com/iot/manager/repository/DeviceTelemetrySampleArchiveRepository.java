package com.iot.manager.repository;

import com.iot.manager.entity.DeviceTelemetrySampleArchive;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface DeviceTelemetrySampleArchiveRepository extends JpaRepository<DeviceTelemetrySampleArchive, Long> {

    boolean existsBySourceSampleId(Long sourceSampleId);

    List<DeviceTelemetrySampleArchive> findBySourceSampleIdIn(List<Long> sourceSampleIds);

    List<DeviceTelemetrySampleArchive> findByDeviceIdAndReceivedAtBetweenOrderByReceivedAtAsc(
            Long deviceId, Instant from, Instant to
    );

    @Query("""
            select sample from DeviceTelemetrySampleArchive sample
            where sample.deviceId = :deviceId
              and sample.receivedAt >= :from and sample.receivedAt < :to
            order by sample.receivedAt asc, sample.id asc
            """)
    List<DeviceTelemetrySampleArchive> findArchivePage(
            @Param("deviceId") Long deviceId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            Pageable pageable
    );

    @Query("""
            select sample from DeviceTelemetrySampleArchive sample
            where sample.deviceId = :deviceId
              and sample.receivedAt >= :from and sample.receivedAt < :to
              and (sample.receivedAt > :afterAt
                   or (sample.receivedAt = :afterAt and sample.id > :afterId))
            order by sample.receivedAt asc, sample.id asc
            """)
    List<DeviceTelemetrySampleArchive> findArchivePageAfter(
            @Param("deviceId") Long deviceId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("afterAt") Instant afterAt,
            @Param("afterId") Long afterId,
            Pageable pageable
    );

    @Query("""
            select sample from DeviceTelemetrySampleArchive sample
            where sample.receivedAt < :cutoff
              and (sample.receivedAt > :cursorAt
                   or (sample.receivedAt = :cursorAt and sample.id > :cursorId))
            order by sample.receivedAt asc, sample.id asc
            """)
    List<DeviceTelemetrySampleArchive> findPurgeCandidatesAfter(
            @Param("cutoff") Instant cutoff,
            @Param("cursorAt") Instant cursorAt,
            @Param("cursorId") Long cursorId,
            Pageable pageable
    );
}
