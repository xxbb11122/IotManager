ALTER TABLE site_weather_settings
    ADD COLUMN IF NOT EXISTS location_source VARCHAR(32);

ALTER TABLE site_weather_settings
    ADD COLUMN IF NOT EXISTS location_accuracy_m DOUBLE PRECISION;

ALTER TABLE site_weather_settings
    ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP WITH TIME ZONE;

UPDATE site_weather_settings
SET location_source = COALESCE(location_source, 'MANUAL'),
    location_updated_at = COALESCE(location_updated_at, CURRENT_TIMESTAMP)
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL;
