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

import java.time.Instant;

@Entity
@Table(name = "site_weather_snapshots")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SiteWeatherSnapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "site_id", nullable = false)
    private Site site;

    @Column(name = "provider_code", nullable = false, length = 32)
    private String providerCode;

    @Column(name = "observed_at", nullable = false)
    private Instant observedAt;

    @Column(name = "fetched_at", nullable = false)
    private Instant fetchedAt;

    /**
     * Identifies the provider/location/time-zone configuration that produced this sample.
     * Historical samples remain available for diagnostics, but only a matching sample may
     * be presented as the current weather for the active site configuration.
     */
    @Column(name = "configuration_fingerprint", length = 128)
    private String configurationFingerprint;

    @Column(name = "weather_code")
    private Integer weatherCode;

    @Column(name = "condition_text", length = 64)
    private String conditionText;

    @Column(name = "temperature_c")
    private Double temperatureC;

    @Column(name = "apparent_temperature_c")
    private Double apparentTemperatureC;

    @Column(name = "relative_humidity_pct")
    private Integer relativeHumidityPct;

    @Column(name = "surface_pressure_hpa")
    private Double surfacePressureHpa;

    @Column(name = "wind_speed_kmh")
    private Double windSpeedKmh;

    @Column(name = "wind_direction_deg")
    private Integer windDirectionDeg;

    @Column(name = "elevation_m")
    private Double elevationM;

    @JdbcTypeCode(Types.LONGVARCHAR)
    @Column(name = "raw_payload_json")
    private String rawPayloadJson;
}
