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
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Entity
@Table(name = "device_commands", uniqueConstraints = @UniqueConstraint(name = "uk_device_commands_command_id", columnNames = "command_id"))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DeviceCommand {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "command_id", nullable = false, unique = true, length = 100)
    private String commandId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "device_id", nullable = false)
    private Device device;

    @Column(nullable = false, length = 100)
    private String type;

    @Column(nullable = false, length = 100)
    private String source;

    @Column(length = 4000)
    private String parametersJson;

    @Column(length = 128)
    private String idempotencyKey;

    @Column(length = 50)
    private String status;

    @Column(length = 2000)
    private String errorMessage;

    @Column(name = "result_json", length = 4000)
    private String resultJson;

    private LocalDateTime requestedAt;

    private LocalDateTime acknowledgedAt;
}
