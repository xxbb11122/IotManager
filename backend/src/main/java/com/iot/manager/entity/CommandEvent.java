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

import java.time.LocalDateTime;

@Entity
@Table(name = "command_events")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CommandEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "command_id", nullable = false)
    private DeviceCommand command;

    /** AppUser id captured when the transition was written; null means system/edge actor. */
    @Column(name = "actor_id")
    private Long actorId;

    /** Immutable organization scope copied from the command's device. */
    @Column(name = "organization_id")
    private Long organizationId;

    /** Immutable site scope copied from the command's device. */
    @Column(name = "site_id")
    private Long siteId;

    @Column(name = "from_status", length = 50)
    private String fromStatus;

    @Column(name = "to_status", nullable = false, length = 50)
    private String toStatus;

    @Column(name = "event_type", nullable = false, length = 100)
    private String eventType;

    @Column(length = 2000)
    private String detail;

    @JdbcTypeCode(Types.LONGVARCHAR)
    @Column(name = "payload_json")
    private String payloadJson;

    @Column(name = "occurred_at", nullable = false)
    private LocalDateTime occurredAt;
}
