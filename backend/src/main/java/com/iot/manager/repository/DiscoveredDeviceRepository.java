package com.iot.manager.repository;

import com.iot.manager.entity.DiscoveredDevice;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface DiscoveredDeviceRepository extends JpaRepository<DiscoveredDevice, Long> {

    Optional<DiscoveredDevice> findByCandidateId(String candidateId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select candidate from DiscoveredDevice candidate where candidate.candidateId = :candidateId")
    Optional<DiscoveredDevice> findByCandidateIdForUpdate(@Param("candidateId") String candidateId);

    Optional<DiscoveredDevice> findByAgentIdAndExternalId(Long agentId, String externalId);

    List<DiscoveredDevice> findByAgentSiteCodeAndStatusOrderByLastSeenDesc(String siteCode, String status);
}
