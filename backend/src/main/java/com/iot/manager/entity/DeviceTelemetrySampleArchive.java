package com.iot.manager.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
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

/** R1 append-only telemetry archive; sourceSampleId makes replay idempotent. */
@Entity
@Table(name = "device_telemetry_samples_archive", uniqueConstraints = @UniqueConstraint(
        name = "uk_telemetry_archive_source_sample", columnNames = "source_sample_id"
))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DeviceTelemetrySampleArchive {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "source_sample_id", nullable = false, unique = true)
    private Long sourceSampleId;

    @Column(name = "device_id", nullable = false)
    private Long deviceId;

    @Column(name = "bucket_start", nullable = false)
    private LocalDateTime bucketStart;

    @Column(name = "sampled_at", nullable = false)
    private LocalDateTime sampledAt;

    @Column(name = "received_at")
    private Instant receivedAt;

    @Column(name = "observed_at")
    private Instant observedAt;

    @Column(name = "observed_time_trust", length = 32)
    private String observedTimeTrust;

    @Column(name = "bucket_start_utc")
    private Instant bucketStartUtc;

    @Column(nullable = false, length = 100)
    private String source;

    @JdbcTypeCode(Types.LONGVARCHAR)
    @Column(name = "state_json", nullable = false)
    private String stateJson;

    @Column(name = "archived_at", nullable = false)
    private Instant archivedAt;
}
