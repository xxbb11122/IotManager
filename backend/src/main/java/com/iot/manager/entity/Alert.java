package com.iot.manager.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
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

    @Column(nullable = false, length = 20)
    private String level;   // INFO / WARNING / CRITICAL

    @Column(nullable = false, length = 500)
    private String message;

    private boolean resolved;

    @Column(nullable = false, length = 30)
    private String status;

    @Column(name = "alert_code", length = 100)
    private String alertCode;

    private LocalDateTime createdAt;
    private LocalDateTime resolvedAt;

    @Column(name = "acknowledged_at")
    private LocalDateTime acknowledgedAt;

    @Column(name = "acknowledged_by", length = 100)
    private String acknowledgedBy;

    @PrePersist
    public void prePersist() {
        this.createdAt = LocalDateTime.now();
        if (this.status == null || this.status.isBlank()) this.status = this.resolved ? "RESOLVED" : "OPEN";
    }
}
