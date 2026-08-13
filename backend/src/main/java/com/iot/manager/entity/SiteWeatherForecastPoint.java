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
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Entity
@Table(name = "site_weather_forecast_points")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SiteWeatherForecastPoint {

    public enum Kind { HOURLY, DAILY }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "site_id", nullable = false)
    private Site site;

    @Enumerated(EnumType.STRING)
    @Column(name = "forecast_kind", nullable = false, length = 16)
    private Kind forecastKind;

    @Column(name = "forecast_at", nullable = false)
    private Instant forecastAt;

    @Column(name = "weather_code")
    private Integer weatherCode;

    @Column(name = "temperature_c")
    private Double temperatureC;

    @Column(name = "temperature_max_c")
    private Double temperatureMaxC;

    @Column(name = "temperature_min_c")
    private Double temperatureMinC;

    @Column(name = "precipitation_probability_pct")
    private Integer precipitationProbabilityPct;

    @Column(name = "wind_speed_kmh")
    private Double windSpeedKmh;

    @Column(name = "fetched_at", nullable = false)
    private Instant fetchedAt;

    @Column(name = "configuration_fingerprint", length = 128)
    private String configurationFingerprint;
}
