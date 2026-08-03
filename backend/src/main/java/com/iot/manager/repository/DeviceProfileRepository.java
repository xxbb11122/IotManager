package com.iot.manager.repository;

import com.iot.manager.entity.DeviceProfile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DeviceProfileRepository extends JpaRepository<DeviceProfile, Long> {

    Optional<DeviceProfile> findByProfileIdAndProfileVersion(String profileId, Integer profileVersion);

    List<DeviceProfile> findByEnabledTrueOrderByProfileIdAscProfileVersionDesc();
}
