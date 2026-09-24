package com.iot.manager.repository;

import com.iot.manager.entity.Alert;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.time.Instant;
import org.springframework.data.domain.Pageable;

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

    boolean existsBySite_IdAndResolvedFalseAndAlertCode(Long siteId, String alertCode);

    List<Alert> findBySite_IdAndResolvedFalseAndAlertCode(Long siteId, String alertCode);

    List<Alert> findTop20ByOrderByCreatedAtDesc();

    List<Alert> findByDevice_Id(Long deviceId);

    void deleteByDeviceId(Long deviceId);

    List<Alert> findByResolvedTrueAndResolvedAtUtcLessThanOrderByResolvedAtUtcAsc(Instant cutoff, Pageable pageable);

    @Query("""
            select alert from Alert alert
            where alert.resolved = true and alert.resolvedAtUtc < :cutoff
              and (alert.resolvedAtUtc > :cursorAt
                   or (alert.resolvedAtUtc = :cursorAt and alert.id > :cursorId))
            order by alert.resolvedAtUtc asc, alert.id asc
            """)
    List<Alert> findRetentionCandidatesAfter(
            @Param("cutoff") Instant cutoff,
            @Param("cursorAt") Instant cursorAt,
            @Param("cursorId") Long cursorId,
            Pageable pageable
    );
}
