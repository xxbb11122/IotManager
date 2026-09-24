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

/** Immutable creation/release evidence for a retention hold. */
@Entity
@Table(name = "retention_hold_events")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RetentionHoldEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "hold_id", nullable = false)
    private RetentionHold hold;

    @Column(nullable = false, length = 32)
    private String action;

    @Column(name = "actor_subject", nullable = false, length = 255)
    private String actorSubject;

    @Column(length = 1000)
    private String detail;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;
}
