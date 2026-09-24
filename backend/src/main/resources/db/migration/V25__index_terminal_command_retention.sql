-- Terminal command retention is based on completion, never request creation.
-- Old commands with unresolved/legacy event references remain untouched.
CREATE INDEX IF NOT EXISTS idx_device_commands_completed_utc
    ON device_commands (completed_at_utc, id);
