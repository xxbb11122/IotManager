package com.iot.manager.repository;

import com.iot.manager.entity.ScheduledTaskLock;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface ScheduledTaskLockRepository extends JpaRepository<ScheduledTaskLock, String> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "5000"))
    @Query("select taskLock from ScheduledTaskLock taskLock where taskLock.taskName = :taskName")
    Optional<ScheduledTaskLock> findForUpdate(@Param("taskName") String taskName);
}
