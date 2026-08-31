package com.iot.manager.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;

import java.sql.Types;

import java.time.LocalDateTime;

@Entity
@Table(name = "device_profiles", uniqueConstraints = @UniqueConstraint(
        name = "uk_device_profiles_identity",
        columnNames = {"profile_id", "profile_version"}
))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DeviceProfile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "profile_id", nullable = false, length = 100)
    private String profileId;

    @Column(name = "profile_version", nullable = false)
    private Integer profileVersion;

    @Column(name = "display_name", nullable = false, length = 255)
    private String displayName;

    @Column(name = "device_type", nullable = false, length = 50)
    private String deviceType;

    @JdbcTypeCode(Types.LONGVARCHAR)
    @Column(name = "definition_json", nullable = false)
    private String definitionJson;

    @Column(name = "definition_hash", nullable = false, length = 64)
    private String definitionHash;

    @Column(nullable = false)
    private boolean enabled;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
