package com.iot.manager.repository;

import com.iot.manager.entity.ActivityEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ActivityEventRepository extends JpaRepository<ActivityEvent, Long> {

    List<ActivityEvent> findByDeviceIdOrderByOccurredAtDesc(Long deviceId);
}
