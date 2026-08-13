package com.iot.manager.repository;

import com.iot.manager.entity.CommandBatch;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.List;

public interface CommandBatchRepository extends JpaRepository<CommandBatch, Long> {

    Optional<CommandBatch> findByBatchId(String batchId);

    Optional<CommandBatch> findBySiteIdAndIdempotencyKey(Long siteId, String idempotencyKey);

    List<CommandBatch> findBySiteCodeOrderByRequestedAtDesc(String siteCode);
}
