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

@Entity
@Table(name = "site_weather_settings")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SiteWeatherSettings {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "site_id", nullable = false, unique = true)
    private Site site;

    private Double latitude;
    private Double longitude;

    @Column(length = 64)
    private String timezone;

    @Column(name = "manual_elevation_m")
    private Double manualElevationM;

    @Column(name = "location_source", length = 32)
    private String locationSource;

    @Column(name = "location_accuracy_m")
    private Double locationAccuracyM;

    @Column(name = "location_updated_at")
    private Instant locationUpdatedAt;

    @Column(name = "last_refresh_attempt_at")
    private Instant lastRefreshAttemptAt;

    @Column(name = "last_refresh_error", length = 512)
    private String lastRefreshError;

    @Column(name = "retry_after")
    private Instant retryAfter;

    @Column(name = "weather_retry_count", nullable = false)
    private int weatherRetryCount;

    @Column(name = "last_manual_refresh_at")
    private Instant lastManualRefreshAt;

    @Column(nullable = false)
    private boolean enabled;

    @Column(name = "provider_code", nullable = false, length = 32)
    private String providerCode;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "condensation_temperature_device_id")
    private Device condensationTemperatureDevice;

    @Column(name = "condensation_temperature_field", length = 128)
    private String condensationTemperatureField;
}
