package com.iot.manager.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Lob;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

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

    @Column(nullable = false, length = 100)
    private String source;

    @Lob
    @Column(name = "state_json", nullable = false)
    private String stateJson;
}
