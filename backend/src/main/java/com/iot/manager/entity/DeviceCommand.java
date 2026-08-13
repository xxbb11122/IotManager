package com.iot.manager.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Entity
@Table(name = "device_commands", uniqueConstraints = @UniqueConstraint(name = "uk_device_commands_command_id", columnNames = "command_id"))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DeviceCommand {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "command_id", nullable = false, unique = true, length = 100)
    private String commandId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "device_id", nullable = false)
    private Device device;

    @Column(nullable = false, length = 100)
    private String type;

    @Column(nullable = false, length = 100)
    private String source;

    @Column(length = 4000)
    private String parametersJson;

    @Column(length = 128)
    private String idempotencyKey;

    @Column(length = 50)
    private String status;

    @Column(length = 2000)
    private String errorMessage;

    @Column(name = "result_json", length = 4000)
    private String resultJson;

    @Column(name = "batch_id", length = 100)
    private String batchId;

    @Column(name = "sequence_no")
    private Long sequenceNo;

    @Column(name = "request_fingerprint", length = 64)
    private String requestFingerprint;

    @Column(name = "request_origin", length = 100)
    private String requestOrigin;

    @Column(name = "requested_by", length = 100)
    private String requestedBy;

    private LocalDateTime requestedAt;

    @Column(name = "sent_at")
    private LocalDateTime sentAt;

    private LocalDateTime acknowledgedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    @Column(name = "failure_code", length = 100)
    private String failureCode;

    @Column(name = "retry_of_command_id", length = 100)
    private String retryOfCommandId;

    @Column(name = "dispatch_attempts", nullable = false)
    private Integer dispatchAttempts;

    @PrePersist
    public void prePersist() {
        if (this.dispatchAttempts == null) this.dispatchAttempts = 0;
        if (this.requestOrigin == null || this.requestOrigin.isBlank()) this.requestOrigin = "LEGACY";
    }
}
