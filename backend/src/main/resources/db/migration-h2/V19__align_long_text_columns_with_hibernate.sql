-- Hibernate maps @JdbcTypeCode(Types.LONGVARCHAR) to VARCHAR(32600) for H2.
-- Keep the long-text mappings consistent with PostgreSQL TEXT without changing
-- checksums of the already released H2 migrations.
ALTER TABLE device_profiles ALTER COLUMN definition_json VARCHAR(32600);

ALTER TABLE edge_agents ALTER COLUMN metadata_json VARCHAR(32600);
ALTER TABLE discovered_devices ALTER COLUMN metadata_json VARCHAR(32600);
ALTER TABLE command_batches ALTER COLUMN parameters_json VARCHAR(32600);
ALTER TABLE command_events ALTER COLUMN payload_json VARCHAR(32600);
ALTER TABLE device_telemetry_samples ALTER COLUMN state_json VARCHAR(32600);

ALTER TABLE site_weather_snapshots ALTER COLUMN raw_payload_json VARCHAR(32600);
