ALTER TABLE site_weather_settings
    ADD COLUMN IF NOT EXISTS last_refresh_attempt_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE site_weather_settings
    ADD COLUMN IF NOT EXISTS last_refresh_error VARCHAR(512);

ALTER TABLE site_weather_settings
    ADD COLUMN IF NOT EXISTS retry_after TIMESTAMP WITH TIME ZONE;

ALTER TABLE site_weather_settings
    ADD COLUMN IF NOT EXISTS weather_retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE site_weather_settings
    ADD COLUMN IF NOT EXISTS last_manual_refresh_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_site_weather_settings_retry_after
    ON site_weather_settings(retry_after);
