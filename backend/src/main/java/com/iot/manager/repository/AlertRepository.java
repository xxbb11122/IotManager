package com.iot.manager.repository;

import com.iot.manager.entity.Alert;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface AlertRepository extends JpaRepository<Alert, Long>, JpaSpecificationExecutor<Alert> {

    List<Alert> findByResolvedFalseOrderByCreatedAtDesc();

    List<Alert> findByLevel(String level);

    long countByResolvedFalse();

    boolean existsByDevice_IdAndResolvedFalseAndLevelAndMessage(
            Long deviceId,
            String level,
            String message
    );

    List<Alert> findTop20ByOrderByCreatedAtDesc();

    List<Alert> findByDevice_Id(Long deviceId);

    void deleteByDeviceId(Long deviceId);
}
