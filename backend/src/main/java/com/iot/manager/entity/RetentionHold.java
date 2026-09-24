package com.iot.manager.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * A deliberately narrow legal/investigation hold.  Retention code treats an
 * active hold as a deny rule; it never tries to infer a release from a reason
 * or an expired business object.
 */
@Entity
@Table(name = "retention_holds")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RetentionHold {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "scope_type", nullable = false, length = 40)
    private String scopeType;

    @Column(name = "scope_id", nullable = false, length = 255)
    private String scopeId;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "ends_at")
    private Instant endsAt;

    @Column(nullable = false, length = 1000)
    private String reason;

    @Column(name = "created_by", nullable = false, length = 255)
    private String createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "released_by", length = 255)
    private String releasedBy;

    @Column(name = "released_at")
    private Instant releasedAt;
}
