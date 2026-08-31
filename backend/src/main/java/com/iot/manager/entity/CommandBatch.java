package com.iot.manager.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;

import java.sql.Types;

import java.time.LocalDateTime;

@Entity
@Table(name = "command_batches")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CommandBatch {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "batch_id", nullable = false, unique = true, length = 100)
    private String batchId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "site_id", nullable = false)
    private Site site;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id")
    private DeviceGroup group;

    @Column(name = "target_kind", nullable = false, length = 30)
    private String targetKind;

    @Column(name = "target_label", nullable = false, length = 255)
    private String targetLabel;

    @Column(nullable = false, length = 100)
    private String type;

    @JdbcTypeCode(Types.LONGVARCHAR)
    @Column(name = "parameters_json")
    private String parametersJson;

    @Column(nullable = false, length = 50)
    private String status;

    @Column(name = "idempotency_key", nullable = false, length = 128)
    private String idempotencyKey;

    @Column(name = "request_fingerprint", nullable = false, length = 64)
    private String requestFingerprint;

    @Column(name = "requested_via", nullable = false, length = 100)
    private String requestedVia;

    @Column(name = "requested_by", length = 100)
    private String requestedBy;

    @Column(name = "requested_at", nullable = false)
    private LocalDateTime requestedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    @Column(name = "retry_of_batch_id", length = 100)
    private String retryOfBatchId;

    @Column(name = "total_count", nullable = false)
    private Integer totalCount;

    @Column(name = "pending_count", nullable = false)
    private Integer pendingCount;

    @Column(name = "sent_count", nullable = false)
    private Integer sentCount;

    @Column(name = "acknowledged_count", nullable = false)
    private Integer acknowledgedCount;

    @Column(name = "failed_count", nullable = false)
    private Integer failedCount;

    @Column(name = "rejected_count", nullable = false)
    private Integer rejectedCount;

    @Column(nullable = false)
    private Long version;
}
