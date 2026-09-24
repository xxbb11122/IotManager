package com.iot.manager.repository;

import com.iot.manager.entity.RetentionHoldEvent;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RetentionHoldEventRepository extends JpaRepository<RetentionHoldEvent, Long> {

    List<RetentionHoldEvent> findByHoldIdOrderByOccurredAtAsc(Long holdId);
}
