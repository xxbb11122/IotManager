package com.iot.manager.repository;

import com.iot.manager.entity.AgentCredentialRotation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AgentCredentialRotationRepository extends JpaRepository<AgentCredentialRotation, Long> {

    List<AgentCredentialRotation> findByOccurredAtUtcLessThanOrderByOccurredAtUtcAsc(Instant cutoff, Pageable pageable);

    @Query("""
            select rotation from AgentCredentialRotation rotation
            left join rotation.previousCredential previousCredential
            left join rotation.replacementCredential replacementCredential
            where rotation.occurredAtUtc < :cutoff
              and (previousCredential is null or previousCredential.status <> 'ACTIVE')
              and (replacementCredential is null or replacementCredential.status <> 'ACTIVE')
              and (rotation.occurredAtUtc > :cursorAt
                   or (rotation.occurredAtUtc = :cursorAt and rotation.id > :cursorId))
            order by rotation.occurredAtUtc asc, rotation.id asc
            """)
    List<AgentCredentialRotation> findRetentionCandidatesAfter(
            @Param("cutoff") Instant cutoff,
            @Param("cursorAt") Instant cursorAt,
            @Param("cursorId") Long cursorId,
            Pageable pageable
    );
}
