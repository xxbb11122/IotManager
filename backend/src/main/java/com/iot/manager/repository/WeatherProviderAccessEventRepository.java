package com.iot.manager.repository;

import com.iot.manager.entity.WeatherProviderAccessEvent;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WeatherProviderAccessEventRepository extends JpaRepository<WeatherProviderAccessEvent, Long> {

    List<WeatherProviderAccessEvent> findByOccurredAtLessThanOrderByOccurredAtAsc(Instant cutoff, Pageable pageable);

    @Query("""
            select event from WeatherProviderAccessEvent event
            where event.occurredAt < :cutoff
              and (event.occurredAt > :cursorAt
                   or (event.occurredAt = :cursorAt and event.id > :cursorId))
            order by event.occurredAt asc, event.id asc
            """)
    List<WeatherProviderAccessEvent> findRetentionCandidatesAfter(
            @Param("cutoff") Instant cutoff,
            @Param("cursorAt") Instant cursorAt,
            @Param("cursorId") Long cursorId,
            Pageable pageable
    );
}
