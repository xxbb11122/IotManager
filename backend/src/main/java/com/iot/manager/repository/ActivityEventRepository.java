package com.iot.manager.repository;

import com.iot.manager.entity.ActivityEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.time.Instant;

@Repository
public interface ActivityEventRepository extends JpaRepository<ActivityEvent, Long> {

    List<ActivityEvent> findByDeviceIdOrderByOccurredAtDesc(Long deviceId);

    Page<ActivityEvent> findByDeviceIdOrderByOccurredAtDesc(Long deviceId, Pageable pageable);

    void deleteByDeviceId(Long deviceId);

    List<ActivityEvent> findByOccurredAtUtcLessThanOrderByOccurredAtUtcAsc(Instant cutoff, Pageable pageable);

    @Query("""
            select event from ActivityEvent event
            where event.occurredAtUtc < :cutoff
              and (event.occurredAtUtc > :cursorAt
                   or (event.occurredAtUtc = :cursorAt and event.id > :cursorId))
            order by event.occurredAtUtc asc, event.id asc
            """)
    List<ActivityEvent> findRetentionCandidatesAfter(
            @Param("cutoff") Instant cutoff,
            @Param("cursorAt") Instant cursorAt,
            @Param("cursorId") Long cursorId,
            Pageable pageable
    );
}
