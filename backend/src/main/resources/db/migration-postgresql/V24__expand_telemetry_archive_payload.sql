-- PostgreSQL hot telemetry uses TEXT. The archive must not truncate a valid
-- hot payload or turn an otherwise eligible retention batch into a dead end.
ALTER TABLE device_telemetry_samples_archive
    ALTER COLUMN state_json TYPE TEXT;
