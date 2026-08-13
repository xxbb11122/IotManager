ALTER TABLE site_weather_snapshots
    ADD COLUMN IF NOT EXISTS configuration_fingerprint VARCHAR(128);

ALTER TABLE site_weather_forecast_points
    ADD COLUMN IF NOT EXISTS configuration_fingerprint VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_site_weather_snapshots_configuration_fetched
    ON site_weather_snapshots (site_id, configuration_fingerprint, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_weather_forecast_configuration_kind_at
    ON site_weather_forecast_points (site_id, configuration_fingerprint, forecast_kind, forecast_at);
