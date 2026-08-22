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

import java.time.Instant;

/**
 * Privacy-safe record of an outbound weather-provider request. It deliberately
 * contains no URL, raw coordinate, token, or provider response payload.
 */
@Entity
@Table(name = "weather_provider_access_events")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WeatherProviderAccessEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "site_id", nullable = false)
    private Site site;

    @Column(name = "provider_code", nullable = false, length = 32)
    private String providerCode;

    @Column(nullable = false, length = 48)
    private String purpose;

    @Column(nullable = false, length = 24)
    private String outcome;

    @Column(name = "coordinate_precision", nullable = false, length = 16)
    private String coordinatePrecision;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(name = "error_code", length = 64)
    private String errorCode;
}
