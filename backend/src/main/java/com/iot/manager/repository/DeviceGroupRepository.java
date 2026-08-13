package com.iot.manager.repository;

import com.iot.manager.entity.DeviceGroup;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface DeviceGroupRepository extends JpaRepository<DeviceGroup, Long> {

    Optional<DeviceGroup> findByPublicId(String publicId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select groupEntity from DeviceGroup groupEntity where groupEntity.publicId = :publicId")
    Optional<DeviceGroup> findByPublicIdForUpdate(@Param("publicId") String publicId);

    List<DeviceGroup> findBySiteCodeAndArchivedAtIsNullOrderByNameAsc(String siteCode);
}
