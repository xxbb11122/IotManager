package com.iot.manager.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "devices")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Device {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, unique = true, length = 64)
    private String deviceId;

    @Column(name = "public_id", nullable = false, unique = true, length = 100)
    private String publicId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "organization_id")
    private Organization organization;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "site_id")
    private Site site;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "space_id")
    private Space space;

    @Column(length = 50)
    private String type;       // SENSOR / GATEWAY / ACTUATOR / CAMERA

    @Column(length = 50)
    private String protocol;   // MQTT / CoAP / HTTP / Modbus

    @Column(nullable = false, length = 20)
    private String status;     // ONLINE / OFFLINE / WARNING / MAINTENANCE

    private String location;

    private String firmwareVersion;

    @Column(nullable = false)
    private Double temperature;   // °C
    @Column(nullable = false)
    private Double humidity;      // %
    @Column(nullable = false)
    private Double cpuUsage;      // %
    @Column(nullable = false)
    private Long   uptimeSeconds;

    @Column(nullable = false)
    private Double signalStrength; // dBm

    @Column(name = "reported_state_json", nullable = false, length = 4000)
    private String reportedStateJson;

    @Column(name = "desired_state_json", nullable = false, length = 4000)
    private String desiredStateJson;

    private LocalDateTime lastSeen;
    private LocalDateTime registeredAt;
    private LocalDateTime updatedAt;

    @PrePersist
    public void prePersist() {
        this.registeredAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
        if (this.publicId == null || this.publicId.isBlank()) this.publicId = "device-" + UUID.randomUUID();
        if (this.status == null) this.status = "OFFLINE";
        if (this.temperature == null) this.temperature = 0D;
        if (this.humidity == null) this.humidity = 0D;
        if (this.cpuUsage == null) this.cpuUsage = 0D;
        if (this.uptimeSeconds == null) this.uptimeSeconds = 0L;
        if (this.signalStrength == null) this.signalStrength = 0D;
        if (this.reportedStateJson == null) this.reportedStateJson = "{}";
        if (this.desiredStateJson == null) this.desiredStateJson = "{}";
    }

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
