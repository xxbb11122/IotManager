-- H2's LONGVARCHAR mapping is VARCHAR(32600), matching the hot telemetry
-- column after V19. PostgreSQL's V24 expands its archive column to TEXT.
ALTER TABLE device_telemetry_samples_archive
    ALTER COLUMN state_json VARCHAR(32600);
