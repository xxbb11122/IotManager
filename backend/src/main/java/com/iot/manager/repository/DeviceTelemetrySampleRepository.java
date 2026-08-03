package com.iot.manager.repository;

import com.iot.manager.entity.DeviceTelemetrySample;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface DeviceTelemetrySampleRepository extends JpaRepository<DeviceTelemetrySample, Long> {

    Optional<DeviceTelemetrySample> findByDeviceIdAndBucketStart(Long deviceId, LocalDateTime bucketStart);

    List<DeviceTelemetrySample> findByDeviceIdAndSampledAtBetweenOrderBySampledAtAsc(
            Long deviceId, LocalDateTime from, LocalDateTime to
    );
}
