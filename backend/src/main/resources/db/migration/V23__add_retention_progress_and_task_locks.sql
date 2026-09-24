-- P1-RETENTION-01 continuation: a retained cursor is a temporary recovery
-- checkpoint, not a permanent exclusion list. The worker clears it only
-- after a complete pass so rows released from a legal/investigation hold are
-- evaluated again on a future scheduled pass.

CREATE TABLE IF NOT EXISTS retention_watermarks (
    watermark_key VARCHAR(100) PRIMARY KEY,
    cursor_at TIMESTAMP WITH TIME ZONE NOT NULL,
    cursor_id BIGINT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_task_locks (
    task_name VARCHAR(100) PRIMARY KEY,
    holder_id VARCHAR(100),
    lease_until TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_task_locks_lease_until
    ON scheduled_task_locks (lease_until);

-- Every hold mutation and every destructive retention batch takes a row lock
-- on this guard. The seed makes the lock available before the first worker
-- runs, including on fresh installations.
INSERT INTO scheduled_task_locks (task_name, holder_id, lease_until, updated_at)
VALUES ('retention-hold-guard', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
