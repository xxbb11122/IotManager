-- Persists the most recent refresh outcome without retaining provider payloads
-- in monitoring systems. It supports support diagnostics after a restart.
ALTER TABLE site_weather_settings
    ADD COLUMN IF NOT EXISTS last_refresh_outcome VARCHAR(32);

ALTER TABLE site_weather_settings
    ADD COLUMN IF NOT EXISTS last_refresh_duration_ms BIGINT;

CREATE INDEX IF NOT EXISTS idx_site_weather_settings_outcome_attempt
    ON site_weather_settings (last_refresh_outcome, last_refresh_attempt_at);
