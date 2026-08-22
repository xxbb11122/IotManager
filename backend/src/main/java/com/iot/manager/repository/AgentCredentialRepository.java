package com.iot.manager.repository;

import com.iot.manager.entity.AgentCredential;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface AgentCredentialRepository extends JpaRepository<AgentCredential, Long> {

    Optional<AgentCredential> findByCredentialId(String credentialId);

    List<AgentCredential> findByAgentIdOrderByCreatedAtDesc(Long agentId);

    List<AgentCredential> findByAgentIdAndStatus(Long agentId, String status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select credential from AgentCredential credential where credential.agent.id = :agentId and credential.status = :status")
    List<AgentCredential> findByAgentIdAndStatusForUpdate(
            @Param("agentId") Long agentId,
            @Param("status") String status
    );
}
