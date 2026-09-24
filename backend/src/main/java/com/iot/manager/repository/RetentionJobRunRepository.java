package com.iot.manager.repository;

import com.iot.manager.entity.RetentionJobRun;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RetentionJobRunRepository extends JpaRepository<RetentionJobRun, Long> {

    List<RetentionJobRun> findTop50ByDataCategoryOrderByStartedAtDesc(String dataCategory);
}
