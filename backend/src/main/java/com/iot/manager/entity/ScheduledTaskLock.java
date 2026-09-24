package com.iot.manager.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/** Database-backed lease used only for bounded scheduled maintenance work. */
@Entity
@Table(name = "scheduled_task_locks")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ScheduledTaskLock {

    @Id
    @Column(name = "task_name", length = 100)
    private String taskName;

    @Column(name = "holder_id", length = 100)
    private String holderId;

    @Column(name = "lease_until", nullable = false)
    private Instant leaseUntil;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
