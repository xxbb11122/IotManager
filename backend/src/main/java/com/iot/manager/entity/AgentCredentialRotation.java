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

/** Immutable audit record for an agent credential issue, rotation or revocation. */
@Entity
@Table(name = "credential_rotations")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AgentCredentialRotation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "agent_id", nullable = false)
    private EdgeAgent agent;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "previous_credential_id")
    private AgentCredential previousCredential;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "replacement_credential_id")
    private AgentCredential replacementCredential;

    @Column(nullable = false, length = 30)
    private String action;

    @Column(name = "actor_subject", length = 255)
    private String actorSubject;

    @Column(length = 1000)
    private String reason;

    @Column(name = "occurred_at", nullable = false)
    private LocalDateTime occurredAt;
}
