-- Read-only reconciliation inventory. Run with psql -v legacy_zone=Asia/Shanghai.
-- Do not infer a zone for historical deployments without provenance.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
WITH pairs AS (
  SELECT 'device_commands' AS source_table, id, 'requested_at' AS source_column,
         requested_at AS legacy_value, requested_at_utc AS utc_value FROM device_commands
  UNION ALL SELECT 'device_commands', id, 'sent_at', sent_at, sent_at_utc FROM device_commands
  UNION ALL SELECT 'device_commands', id, 'completed_at', completed_at, completed_at_utc FROM device_commands
  UNION ALL SELECT 'device_commands', id, 'expires_at', expires_at, expires_at_utc FROM device_commands
  UNION ALL SELECT 'activity_events', id, 'occurred_at', occurred_at, occurred_at_utc FROM activity_events
  UNION ALL SELECT 'command_events', id, 'occurred_at', occurred_at, occurred_at_utc FROM command_events
  UNION ALL SELECT 'credential_rotations', id, 'occurred_at', occurred_at, occurred_at_utc FROM credential_rotations
  UNION ALL SELECT 'alerts', id, 'created_at', created_at, created_at_utc FROM alerts
  UNION ALL SELECT 'alerts', id, 'resolved_at', resolved_at, resolved_at_utc FROM alerts
)
SELECT source_table, id, source_column, legacy_value, utc_value,
       utc_value AT TIME ZONE :'legacy_zone' AS expected_legacy_value,
       :'legacy_zone' AS assumed_proven_legacy_zone
FROM pairs
WHERE utc_value IS NOT NULL
  AND legacy_value IS DISTINCT FROM (utc_value AT TIME ZONE :'legacy_zone')
ORDER BY source_table, id, source_column;
ROLLBACK;
