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

import java.time.LocalDateTime;

@Entity
@Table(name = "device_connections")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DeviceConnection {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "device_id", nullable = false)
    private Device device;

    @Column(nullable = false, length = 50)
    private String transport;

    @Column(length = 100)
    private String profileId;

    @Column(name = "profile_version")
    private Integer profileVersion;

    @Column(length = 255)
    private String externalId;

    @Column(length = 50)
    private String status;

    @Column(name = "agent_id", length = 100)
    private String agentId;

    @Column(name = "driver_id", length = 100)
    private String driverId;

    @Column(name = "last_seen")
    private LocalDateTime lastSeen;

    @Column(name = "connected_at")
    private LocalDateTime connectedAt;

    @Column(name = "disconnected_at")
    private LocalDateTime disconnectedAt;

    @Column(length = 4000)
    private String metadataJson;
}
