DELETE FROM device_commands AS duplicate
WHERE duplicate.idempotency_key IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM device_commands AS retained
      WHERE retained.device_id = duplicate.device_id
        AND retained.idempotency_key = duplicate.idempotency_key
        AND retained.id < duplicate.id
  );

DROP INDEX IF EXISTS idx_device_commands_device_idempotency;

CREATE UNIQUE INDEX IF NOT EXISTS uk_device_commands_device_idempotency
    ON device_commands (device_id, idempotency_key);
