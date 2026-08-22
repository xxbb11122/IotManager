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
@Table(name = "activity_events")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ActivityEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "device_id", nullable = false)
    private Device device;

    /** AppUser id captured when the event was written; null means system/legacy actor. */
    @Column(name = "actor_id")
    private Long actorId;

    /** Immutable organization scope copied from the device at event time. */
    @Column(name = "organization_id")
    private Long organizationId;

    /** Immutable site scope copied from the device at event time. */
    @Column(name = "site_id")
    private Long siteId;

    @Column(nullable = false, length = 100)
    private String eventType;

    @Column(length = 2000)
    private String detail;

    @Column(length = 4000)
    private String payloadJson;

    @Column(nullable = false)
    private LocalDateTime occurredAt;
}
