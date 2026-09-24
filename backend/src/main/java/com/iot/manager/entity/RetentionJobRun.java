package com.iot.manager.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/** Immutable operational evidence for one retention category in one run. */
@Entity
@Table(name = "retention_job_runs")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RetentionJobRun {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "run_id", nullable = false, length = 100)
    private String runId;

    @Column(name = "policy_version", nullable = false, length = 64)
    private String policyVersion;

    @Column(name = "dry_run", nullable = false)
    private boolean dryRun;

    @Column(name = "data_category", nullable = false, length = 64)
    private String dataCategory;

    @Column(nullable = false, length = 32)
    private String status;

    @Column(name = "window_start")
    private Instant windowStart;

    @Column(name = "window_end")
    private Instant windowEnd;

    @Column(name = "estimated_rows", nullable = false)
    private long estimatedRows;

    @Column(name = "archived_rows", nullable = false)
    private long archivedRows;

    @Column(name = "deleted_rows", nullable = false)
    private long deletedRows;

    @Column(name = "held_rows", nullable = false)
    private long heldRows;

    @Column(name = "failed_rows", nullable = false)
    private long failedRows;

    @Column(name = "watermark")
    private Instant watermark;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "failure_reason", length = 2000)
    private String failureReason;

    @Column(name = "correlation_id", length = 100)
    private String correlationId;
}
