package com.iot.manager.repository;

import com.iot.manager.entity.CommandEvent;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.time.Instant;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CommandEventRepository extends JpaRepository<CommandEvent, Long> {

    List<CommandEvent> findByCommandCommandIdOrderByOccurredAtAsc(String commandId);

    @Query("""
            select event from CommandEvent event
            where event.occurredAtUtc < :cutoff
              and event.command.status in ('ACKNOWLEDGED', 'FAILED', 'UNCONFIRMED', 'REJECTED')
            order by event.occurredAtUtc asc
            """)
    List<CommandEvent> findRetainableBefore(@Param("cutoff") Instant cutoff, Pageable pageable);

    @Query("""
            select event from CommandEvent event
            where event.occurredAtUtc < :cutoff
              and event.command.status in ('ACKNOWLEDGED', 'FAILED', 'UNCONFIRMED', 'REJECTED')
              and (event.occurredAtUtc > :cursorAt
                   or (event.occurredAtUtc = :cursorAt and event.id > :cursorId))
            order by event.occurredAtUtc asc, event.id asc
            """)
    List<CommandEvent> findRetentionCandidatesAfter(
            @Param("cutoff") Instant cutoff,
            @Param("cursorAt") Instant cursorAt,
            @Param("cursorId") Long cursorId,
            Pageable pageable
    );
}
