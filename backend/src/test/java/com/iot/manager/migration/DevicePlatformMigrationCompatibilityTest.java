package com.iot.manager.migration;

import org.flywaydb.core.Flyway;
import org.hibernate.cfg.AvailableSettings;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;

import javax.sql.DataSource;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class DevicePlatformMigrationCompatibilityTest {

    private static final String[] H2_MIGRATION_LOCATIONS = {
            "classpath:db/migration",
            "classpath:db/migration-h2"
    };

    @Test
    void migratesLegacyV1DeviceAndDuplicateCommandsThroughLatestSchemaAndValidatesJpaSchema() {
        String url = "jdbc:h2:mem:legacy-device-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE";

        Flyway.configure()
                .dataSource(url, "sa", "")
                .locations(H2_MIGRATION_LOCATIONS)
                .target("1")
                .load()
                .migrate();

        DataSource dataSource = new DriverManagerDataSource(url, "sa", "");
        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.update("""
                INSERT INTO devices (
                    name, device_id, type, protocol, status, location, firmware_version,
                    temperature, humidity, cpu_usage, uptime_seconds, signal_strength,
                    last_seen, registered_at, updated_at
                ) VALUES (
                    'Legacy device', 'legacy-device-001', 'SENSOR', 'MQTT', NULL, 'Legacy location', '1.0',
                    NULL, NULL, NULL, NULL, NULL,
                    NULL, NULL, NULL
                )
                """);

        Flyway.configure()
                .dataSource(url, "sa", "")
                .locations(H2_MIGRATION_LOCATIONS)
                .target("2")
                .load()
                .migrate();

        Long legacyDeviceId = jdbcTemplate.queryForObject(
                "SELECT id FROM devices WHERE device_id = 'legacy-device-001'",
                Long.class
        );
        insertCommand(jdbcTemplate, "legacy-command-first", legacyDeviceId, "legacy-retry-key");
        insertCommand(jdbcTemplate, "legacy-command-second", legacyDeviceId, "legacy-retry-key");
        insertCommand(jdbcTemplate, "legacy-command-null-first", legacyDeviceId, null);
        insertCommand(jdbcTemplate, "legacy-command-null-second", legacyDeviceId, null);

        Flyway throughV14 = Flyway.configure()
                .dataSource(url, "sa", "")
                .locations(H2_MIGRATION_LOCATIONS)
                .target("14")
                .load();
        throughV14.migrate();

        Long legacyCommandId = jdbcTemplate.queryForObject("""
                SELECT id FROM device_commands WHERE command_id = 'legacy-command-first'
                """, Long.class);
        jdbcTemplate.update("""
                INSERT INTO activity_events (device_id, event_type, detail, payload_json, occurred_at)
                VALUES (?, 'LEGACY_ACTIVITY', 'Legacy activity', '{}', CURRENT_TIMESTAMP)
                """, legacyDeviceId);
        jdbcTemplate.update("""
                INSERT INTO command_events (command_id, to_status, event_type, detail, payload_json, occurred_at)
                VALUES (?, 'REQUESTED', 'LEGACY_COMMAND_EVENT', 'Legacy command event', '{}', CURRENT_TIMESTAMP)
                """, legacyCommandId);

        Flyway latest = Flyway.configure()
                .dataSource(url, "sa", "")
                .locations(H2_MIGRATION_LOCATIONS)
                .load();
        latest.migrate();

        assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("18");
        assertThat(jdbcTemplate.queryForObject("""
                SELECT command_id
                FROM device_commands
                WHERE device_id = ? AND idempotency_key = 'legacy-retry-key'
                ORDER BY id
                """, String.class, legacyDeviceId)).isEqualTo("legacy-command-first");
        assertThat(jdbcTemplate.queryForObject("""
                SELECT COUNT(*)
                FROM device_commands
                WHERE device_id = ? AND idempotency_key = 'legacy-retry-key'
                """, Long.class, legacyDeviceId)).isEqualTo(1L);
        assertThat(jdbcTemplate.queryForObject("""
                SELECT COUNT(*)
                FROM device_commands
                WHERE device_id = ? AND idempotency_key IS NULL
                """, Long.class, legacyDeviceId)).isEqualTo(2L);
        assertThat(jdbcTemplate.queryForObject("""
                SELECT source
                FROM device_commands
                WHERE command_id = 'legacy-command-first'
                """, String.class)).isEqualTo("LEGACY");
        assertThat(jdbcTemplate.queryForObject("""
                SELECT result_json
                FROM device_commands
                WHERE command_id = 'legacy-command-first'
                """, String.class)).isNull();

        LegacyDevice migrated = jdbcTemplate.queryForObject("""
                SELECT public_id, status, temperature, humidity, cpu_usage, uptime_seconds,
                       signal_strength, reported_state_json, desired_state_json,
                       organization_id, site_id, space_id
                FROM devices
                WHERE device_id = 'legacy-device-001'
                """, (resultSet, rowNumber) -> new LegacyDevice(
                resultSet.getString("public_id"),
                resultSet.getString("status"),
                resultSet.getDouble("temperature"),
                resultSet.getDouble("humidity"),
                resultSet.getDouble("cpu_usage"),
                resultSet.getLong("uptime_seconds"),
                resultSet.getDouble("signal_strength"),
                resultSet.getString("reported_state_json"),
                resultSet.getString("desired_state_json"),
                resultSet.getLong("organization_id"),
                resultSet.getLong("site_id"),
                resultSet.getLong("space_id")
        ));

        assertThat(migrated.publicId()).startsWith("device-");
        assertThat(migrated.status()).isEqualTo("OFFLINE");
        assertThat(migrated.temperature()).isZero();
        assertThat(migrated.humidity()).isZero();
        assertThat(migrated.cpuUsage()).isZero();
        assertThat(migrated.uptimeSeconds()).isZero();
        assertThat(migrated.signalStrength()).isZero();
        assertThat(migrated.reportedStateJson()).isEqualTo("{}");
        assertThat(migrated.desiredStateJson()).isEqualTo("{}");
        assertThat(migrated.organizationId()).isPositive();
        assertThat(migrated.siteId()).isPositive();
        assertThat(migrated.spaceId()).isPositive();
        assertThat(jdbcTemplate.queryForObject("""
                SELECT organization_id FROM activity_events WHERE event_type = 'LEGACY_ACTIVITY'
                """, Long.class)).isEqualTo(migrated.organizationId());
        assertThat(jdbcTemplate.queryForObject("""
                SELECT site_id FROM activity_events WHERE event_type = 'LEGACY_ACTIVITY'
                """, Long.class)).isEqualTo(migrated.siteId());
        assertThat(jdbcTemplate.queryForObject("""
                SELECT organization_id FROM command_events WHERE event_type = 'LEGACY_COMMAND_EVENT'
                """, Long.class)).isEqualTo(migrated.organizationId());
        assertThat(jdbcTemplate.queryForObject("""
                SELECT site_id FROM command_events WHERE event_type = 'LEGACY_COMMAND_EVENT'
                """, Long.class)).isEqualTo(migrated.siteId());
        assertThat(jdbcTemplate.queryForObject("""
                SELECT location_source
                FROM site_weather_settings
                WHERE latitude IS NOT NULL AND longitude IS NOT NULL
                LIMIT 1
                """, String.class)).isEqualTo("MANUAL");
        assertThat(jdbcTemplate.queryForObject("""
                SELECT weather_retry_count
                FROM site_weather_settings
                WHERE latitude IS NOT NULL AND longitude IS NOT NULL
                LIMIT 1
                """, Integer.class)).isZero();
        assertThat(jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_name = 'SITE_WEATHER_SETTINGS' AND column_name = 'LAST_REFRESH_OUTCOME'
                """, Integer.class)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM information_schema.tables
                WHERE table_name = 'WEATHER_PROVIDER_ACCESS_EVENTS'
                """, Integer.class)).isEqualTo(1);

        assertHibernateValidationPasses(dataSource);
    }

    private void insertCommand(JdbcTemplate jdbcTemplate, String commandId, Long deviceId, String idempotencyKey) {
        jdbcTemplate.update("""
                INSERT INTO device_commands (command_id, device_id, type, idempotency_key, status, requested_at)
                VALUES (?, ?, 'SYNC', ?, 'REQUESTED', CURRENT_TIMESTAMP)
                """, new Object[]{commandId, deviceId, idempotencyKey});
    }

    private void assertHibernateValidationPasses(DataSource dataSource) {
        LocalContainerEntityManagerFactoryBean entityManagerFactory = new LocalContainerEntityManagerFactoryBean();
        entityManagerFactory.setDataSource(dataSource);
        entityManagerFactory.setPackagesToScan("com.iot.manager.entity");
        entityManagerFactory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
        entityManagerFactory.setJpaPropertyMap(Map.of(
                AvailableSettings.HBM2DDL_AUTO, "validate",
                AvailableSettings.PHYSICAL_NAMING_STRATEGY,
                "org.hibernate.boot.model.naming.CamelCaseToUnderscoresNamingStrategy"
        ));

        try {
            entityManagerFactory.afterPropertiesSet();
            assertThat(entityManagerFactory.getObject()).isNotNull();
        } finally {
            entityManagerFactory.destroy();
        }
    }

    private record LegacyDevice(
            String publicId,
            String status,
            double temperature,
            double humidity,
            double cpuUsage,
            long uptimeSeconds,
            double signalStrength,
            String reportedStateJson,
            String desiredStateJson,
            long organizationId,
            long siteId,
            long spaceId
    ) {
    }
}
