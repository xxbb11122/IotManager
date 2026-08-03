package com.iot.manager.repository;

import com.iot.manager.entity.EdgeAgent;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface EdgeAgentRepository extends JpaRepository<EdgeAgent, Long> {

    Optional<EdgeAgent> findByAgentId(String agentId);

    boolean existsBySiteCodeAndStatus(String siteCode, String status);
}
