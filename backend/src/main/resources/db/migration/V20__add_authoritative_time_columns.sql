-- P0-TIME-01: keep legacy wall-clock fields during the Expand/Contract
-- window, but add UTC-aware server receipt and source-observed timestamps.
-- No historical value is shifted here: a TIMESTAMP without provenance cannot
-- safely be identified as a UTC or Asia/Shanghai wall-clock value.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE edge_agents ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE edge_agents ADD COLUMN IF NOT EXISTS reported_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE edge_agents ADD COLUMN IF NOT EXISTS reported_time_trust VARCHAR(32);
ALTER TABLE edge_agents ADD COLUMN IF NOT EXISTS reported_clock_skew_ms BIGINT;

ALTER TABLE device_connections ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE device_connections ADD COLUMN IF NOT EXISTS reported_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE discovered_devices ADD COLUMN IF NOT EXISTS first_received_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE discovered_devices ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE discovered_devices ADD COLUMN IF NOT EXISTS reported_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE device_telemetry_samples ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE device_telemetry_samples ADD COLUMN IF NOT EXISTS observed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE device_telemetry_samples ADD COLUMN IF NOT EXISTS observed_time_trust VARCHAR(32);
ALTER TABLE device_telemetry_samples ADD COLUMN IF NOT EXISTS bucket_start_utc TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_device_telemetry_device_received
    ON device_telemetry_samples (device_id, received_at);
CREATE UNIQUE INDEX IF NOT EXISTS uk_device_telemetry_bucket_utc
    ON device_telemetry_samples (device_id, bucket_start_utc);
CREATE INDEX IF NOT EXISTS idx_edge_agents_last_received
    ON edge_agents (site_id, last_received_at);
CREATE INDEX IF NOT EXISTS idx_device_connections_last_received
    ON device_connections (agent_id, last_received_at);
