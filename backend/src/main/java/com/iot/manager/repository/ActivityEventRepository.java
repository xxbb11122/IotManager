package com.iot.manager.repository;

import com.iot.manager.entity.ActivityEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ActivityEventRepository extends JpaRepository<ActivityEvent, Long> {

    List<ActivityEvent> findByDeviceIdOrderByOccurredAtDesc(Long deviceId);

    Page<ActivityEvent> findByDeviceIdOrderByOccurredAtDesc(Long deviceId, Pageable pageable);

    void deleteByDeviceId(Long deviceId);
}
