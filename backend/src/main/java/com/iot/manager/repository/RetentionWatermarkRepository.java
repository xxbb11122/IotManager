package com.iot.manager.repository;

import com.iot.manager.entity.RetentionWatermark;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RetentionWatermarkRepository extends JpaRepository<RetentionWatermark, String> {
}
