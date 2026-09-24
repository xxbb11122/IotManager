package com.iot.manager.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * A short-lived checkpoint for a bounded retention pass. It is deleted after
 * a complete pass so legal holds are reconsidered when they are released.
 */
@Entity
@Table(name = "retention_watermarks")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RetentionWatermark {

    @Id
    @Column(name = "watermark_key", length = 100)
    private String watermarkKey;

    @Column(name = "cursor_at", nullable = false)
    private Instant cursorAt;

    @Column(name = "cursor_id", nullable = false)
    private long cursorId;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
