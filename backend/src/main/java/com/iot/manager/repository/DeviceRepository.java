package com.iot.manager.repository;

import com.iot.manager.entity.Device;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface DeviceRepository extends JpaRepository<Device, Long> {

    @EntityGraph(attributePaths = {"organization", "site", "space"})
    Optional<Device> findByDeviceId(String deviceId);

    @EntityGraph(attributePaths = {"organization", "site", "space"})
    List<Device> findByStatusAndArchivedAtIsNull(String status);

    @EntityGraph(attributePaths = {"organization", "site", "space"})
    List<Device> findByTypeAndArchivedAtIsNull(String type);

    @Override
    @EntityGraph(attributePaths = {"organization", "site", "space"})
    Optional<Device> findById(Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select device from Device device where device.id = :id")
    Optional<Device> findByIdForUpdate(@Param("id") Long id);

    @Override
    @EntityGraph(attributePaths = {"organization", "site", "space"})
    List<Device> findAll(org.springframework.data.domain.Sort sort);

    long countByStatusAndArchivedAtIsNull(String status);

    @Query("SELECT d.status, COUNT(d) FROM Device d WHERE d.archivedAt IS NULL GROUP BY d.status")
    List<Object[]> countGroupByStatus();

    @Query("SELECT d.type, COUNT(d) FROM Device d WHERE d.archivedAt IS NULL GROUP BY d.type")
    List<Object[]> countGroupByType();

    @EntityGraph(attributePaths = {"organization", "site", "space"})
    @Query("select d from Device d where d.archivedAt is null and (d.name like concat('%', :search, '%') or d.deviceId like concat('%', :search, '%'))")
    List<Device> findActiveByNameContainingOrDeviceIdContaining(@Param("search") String search);

    @Query("select d from Device d where d.archivedAt is null")
    List<Device> findAllActive(org.springframework.data.domain.Sort sort);
}
