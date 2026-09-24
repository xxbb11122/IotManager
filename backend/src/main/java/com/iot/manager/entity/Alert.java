package com.iot.manager.entity;

import jakarta.persistence.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;
import lombok.*;
import java.time.Instant;
import java.time.LocalDateTime;

@Entity
@EntityListeners(AuditingEntityListener.class)
@Table(name = "alerts")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Alert {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "device_id")
    private Device device;

    /**
     * A platform or edge-agent alert may apply to a site without identifying a
     * single device.  Device alerts keep their existing association.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "site_id")
    private Site site;

    @Column(nullable = false, length = 20)
    private String level;   // INFO / WARNING / CRITICAL

    @Column(nullable = false, length = 500)
    private String message;

    private boolean resolved;

    @Column(nullable = false, length = 30)
    private String status;

    @Column(name = "alert_code", length = 100)
    private String alertCode;

    @CreatedDate
    private LocalDateTime createdAt;
    private LocalDateTime resolvedAt;

    @Column(name = "created_at_utc")
    private Instant createdAtUtc;

    @Column(name = "resolved_at_utc")
    private Instant resolvedAtUtc;

    @Column(name = "acknowledged_at")
    private LocalDateTime acknowledgedAt;

    @Column(name = "acknowledged_by", length = 100)
    private String acknowledgedBy;

    @PrePersist
    public void prePersist() {
        if (this.status == null || this.status.isBlank()) this.status = this.resolved ? "RESOLVED" : "OPEN";
    }
}
