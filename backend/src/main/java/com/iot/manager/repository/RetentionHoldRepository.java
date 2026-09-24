package com.iot.manager.repository;

import com.iot.manager.entity.RetentionHold;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface RetentionHoldRepository extends JpaRepository<RetentionHold, Long> {

    @Query("""
            select hold from RetentionHold hold
            where hold.releasedAt is null and hold.startsAt <= :now
              and (hold.endsAt is null or hold.endsAt > :now)
            """)
    List<RetentionHold> findActiveAt(@Param("now") Instant now);
}
