ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS source VARCHAR(100);
ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS result_json VARCHAR(4000);

UPDATE device_commands
SET source = 'LEGACY'
WHERE source IS NULL OR TRIM(source) = '';

ALTER TABLE device_commands ALTER COLUMN source SET NOT NULL;
