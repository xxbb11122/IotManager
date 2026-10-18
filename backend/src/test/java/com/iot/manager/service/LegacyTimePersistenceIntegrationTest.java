package com.iot.manager.service;

import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceCommand;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Independent N-1 JDBC reads must see the original wall-clock value. */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class LegacyTimePersistenceIntegrationTest {
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;
    @Autowired TimeProvider time;

    @Test
    void legacyAndUtcColumnsKeepTheirDistinctSemantics() {
        Instant instant = Instant.parse("2026-10-18T07:55:27.460578Z");
        DeviceCommand command = command();
        LocalDateTime legacy = time.legacyServer(instant);
        command.setRequestedAt(legacy);
        command.setRequestedAtUtc(instant);
        command.setSentAt(legacy.plusSeconds(1));
        command.setSentAtUtc(instant.plusSeconds(1));
        command.setCompletedAt(legacy.plusSeconds(2));
        command.setCompletedAtUtc(instant.plusSeconds(2));
        command.setExpiresAt(legacy.plusSeconds(30));
        command.setExpiresAtUtc(instant.plusSeconds(30));
        entityManager.persist(command);
        entityManager.flush();
        entityManager.clear();

        // getTimestamp without Calendar is how the old Hibernate mapping reads.
        jdbc.query("SELECT * FROM device_commands WHERE id = ?", row -> {
            for (String column : new String[]{"requested_at", "sent_at", "completed_at", "expires_at"}) {
                int seconds = switch (column) {
                    case "sent_at" -> 1;
                    case "completed_at" -> 2;
                    case "expires_at" -> 30;
                    default -> 0;
                };
                assertThat(row.getTimestamp(column).toLocalDateTime()).as("N-1 JDBC %s", column)
                        .isEqualTo(legacy.plusSeconds(seconds));
                assertThat(row.getObject(column, LocalDateTime.class)).as("SQL wall-clock %s", column)
                        .isEqualTo(legacy.plusSeconds(seconds));
                assertThat(row.getObject(column + "_utc", OffsetDateTime.class).toInstant())
                        .as("absolute %s", column).isEqualTo(instant.plusSeconds(seconds));
            }
        }, command.getId());
        DeviceCommand loaded = entityManager.find(DeviceCommand.class, command.getId());
        assertThat(loaded.getRequestedAt()).isEqualTo(legacy);
        assertThat(loaded.getRequestedAtUtc()).isEqualTo(instant);
    }

    @Test
    void nReadsAnOldWriteWithoutInventingAnAuthoritativeTimestamp() {
        DeviceCommand command = command();
        command.setRequestedAt(time.legacyServer(Instant.parse("2026-10-18T07:55:27Z")));
        entityManager.persist(command);
        entityManager.flush();
        LocalDateTime oldWrite = LocalDateTime.of(2026, 10, 18, 16, 1, 2);
        jdbc.update("UPDATE device_commands SET requested_at = ?, requested_at_utc = NULL WHERE id = ?",
                oldWrite, command.getId());
        entityManager.clear();
        DeviceCommand loaded = entityManager.find(DeviceCommand.class, command.getId());
        assertThat(loaded.getRequestedAt()).isEqualTo(oldWrite);
        assertThat(loaded.getRequestedAtUtc()).isNull();
        assertThat(time.legacyServerInstant(loaded.getRequestedAt()))
                .isEqualTo(oldWrite.atZone(ZoneId.of("Asia/Shanghai")).toInstant());
    }

    private DeviceCommand command() {
        Device device = Device.builder().name("Time compatibility").deviceId("time-" + UUID.randomUUID()).build();
        entityManager.persist(device);
        return DeviceCommand.builder().device(device).commandId("time-" + UUID.randomUUID())
                .type("set_power").source("TEST").status("QUEUED").build();
    }
}
