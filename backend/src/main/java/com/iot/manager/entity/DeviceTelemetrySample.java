package com.iot.manager.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;

import java.sql.Types;

import java.time.Instant;
import java.time.LocalDateTime;

@Entity
@Table(name = "device_telemetry_samples", uniqueConstraints = @UniqueConstraint(
        name = "uk_device_telemetry_bucket", columnNames = {"device_id", "bucket_start"}
))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DeviceTelemetrySample {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "device_id", nullable = false)
    private Device device;

    @Column(name = "bucket_start", nullable = false)
    private LocalDateTime bucketStart;

    @Column(name = "sampled_at", nullable = false)
    private LocalDateTime sampledAt;

    /** Server-authoritative receipt time used by all new range and latest-value queries. */
    @Column(name = "received_at")
    private Instant receivedAt;

    /** Optional time supplied by the agent/device, retained for diagnostics and display. */
    @Column(name = "observed_at")
    private Instant observedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "observed_time_trust", length = 32)
    private ObservedTimeTrust observedTimeTrust;

    @Column(name = "bucket_start_utc")
    private Instant bucketStartUtc;

    @Column(nullable = false, length = 100)
    private String source;

    @JdbcTypeCode(Types.LONGVARCHAR)
    @Column(name = "state_json", nullable = false)
    private String stateJson;
}
