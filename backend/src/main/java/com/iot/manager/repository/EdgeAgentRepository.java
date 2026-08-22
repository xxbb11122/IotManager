package com.iot.manager.repository;

import com.iot.manager.entity.EdgeAgent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;
import java.util.Optional;

public interface EdgeAgentRepository extends JpaRepository<EdgeAgent, Long> {

    Optional<EdgeAgent> findByAgentId(String agentId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select agent from EdgeAgent agent where agent.agentId = :agentId")
    Optional<EdgeAgent> findByAgentIdForUpdate(@Param("agentId") String agentId);

    boolean existsBySiteCodeAndStatus(String siteCode, String status);
}
