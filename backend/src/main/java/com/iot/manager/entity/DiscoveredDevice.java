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
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Entity
@Table(name = "discovered_devices")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveredDevice {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "candidate_id", nullable = false, unique = true, length = 100)
    private String candidateId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "agent_id", nullable = false)
    private EdgeAgent agent;

    @Column(name = "external_id", nullable = false, length = 255)
    private String externalId;

    @Column(name = "profile_id", nullable = false, length = 100)
    private String profileId;

    @Column(name = "profile_version", nullable = false)
    private Integer profileVersion;

    @Column(name = "display_name", nullable = false, length = 255)
    private String displayName;

    @Column(length = 100)
    private String manufacturer;

    @Column(length = 100)
    private String model;

    @Column(length = 500)
    private String endpoint;

    @Column(nullable = false, length = 30)
    private String status;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "claimed_device_id")
    private Device claimedDevice;

    @Column(name = "first_seen", nullable = false)
    private LocalDateTime firstSeen;

    @Column(name = "last_seen", nullable = false)
    private LocalDateTime lastSeen;

    @Lob
    @Column(name = "metadata_json")
    private String metadataJson;
}
