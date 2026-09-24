package com.iot.manager.repository;

import com.iot.manager.entity.DeviceTelemetrySample;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface DeviceTelemetrySampleRepository extends JpaRepository<DeviceTelemetrySample, Long> {

    Optional<DeviceTelemetrySample> findByDeviceIdAndBucketStart(Long deviceId, LocalDateTime bucketStart);

    Optional<DeviceTelemetrySample> findByDeviceIdAndBucketStartUtc(Long deviceId, Instant bucketStartUtc);

    List<DeviceTelemetrySample> findByDeviceIdAndSampledAtBetweenOrderBySampledAtAsc(
            Long deviceId, LocalDateTime from, LocalDateTime to
    );

    List<DeviceTelemetrySample> findByDeviceIdAndReceivedAtBetweenOrderByReceivedAtAsc(
            Long deviceId, Instant from, Instant to
    );

    List<DeviceTelemetrySample> findByDeviceIdAndReceivedAtIsNullAndSampledAtBetweenOrderBySampledAtAsc(
            Long deviceId, LocalDateTime from, LocalDateTime to
    );

    @Query("""
            select sample from DeviceTelemetrySample sample
            where sample.receivedAt < :hotCutoff
              and (sample.receivedAt > :cursorAt
                   or (sample.receivedAt = :cursorAt and sample.id > :cursorId))
            order by sample.receivedAt asc, sample.id asc
            """)
    List<DeviceTelemetrySample> findArchiveCandidatesAfter(
            @Param("hotCutoff") Instant hotCutoff,
            @Param("cursorAt") Instant cursorAt,
            @Param("cursorId") Long cursorId,
            Pageable pageable
    );

    Optional<DeviceTelemetrySample> findTopByDeviceIdOrderBySampledAtDesc(Long deviceId);

    Optional<DeviceTelemetrySample> findTopByDeviceIdAndReceivedAtIsNotNullOrderByReceivedAtDesc(Long deviceId);
}
