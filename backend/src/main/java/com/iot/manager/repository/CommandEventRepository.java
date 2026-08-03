package com.iot.manager.repository;

import com.iot.manager.entity.CommandEvent;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CommandEventRepository extends JpaRepository<CommandEvent, Long> {

    List<CommandEvent> findByCommandCommandIdOrderByOccurredAtAsc(String commandId);
}
