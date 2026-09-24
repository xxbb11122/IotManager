-- Read-only PostgreSQL evidence for the V20/V21 Expand migration.
-- Run with psql against a protected snapshot or production in read-only mode:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/db/legacy-time-reconciliation.sql
-- No value is shifted or inferred from a legacy TIMESTAMP without provenance.

\pset null '<NULL>'
\echo 'IotManager legacy time reconciliation: authoritative fields vs unknown legacy rows'
BEGIN TRANSACTION READ ONLY;

SELECT 'device_telemetry_samples' AS data_set,
       COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE received_at IS NOT NULL) AS authoritative_rows,
       COUNT(*) FILTER (WHERE received_at IS NULL) AS legacy_unknown_rows,
       MIN(sampled_at) AS legacy_min_timestamp,
       MAX(sampled_at) AS legacy_max_timestamp,
       MIN(received_at) AS authoritative_min_utc,
       MAX(received_at) AS authoritative_max_utc
FROM device_telemetry_samples;

SELECT 'activity_events' AS data_set,
       COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE occurred_at_utc IS NOT NULL) AS authoritative_rows,
       COUNT(*) FILTER (WHERE occurred_at_utc IS NULL) AS legacy_unknown_rows,
       MIN(occurred_at) AS legacy_min_timestamp,
       MAX(occurred_at) AS legacy_max_timestamp,
       MIN(occurred_at_utc) AS authoritative_min_utc,
       MAX(occurred_at_utc) AS authoritative_max_utc
FROM activity_events;

SELECT 'command_events' AS data_set,
       COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE occurred_at_utc IS NOT NULL) AS authoritative_rows,
       COUNT(*) FILTER (WHERE occurred_at_utc IS NULL) AS legacy_unknown_rows,
       MIN(occurred_at) AS legacy_min_timestamp,
       MAX(occurred_at) AS legacy_max_timestamp,
       MIN(occurred_at_utc) AS authoritative_min_utc,
       MAX(occurred_at_utc) AS authoritative_max_utc
FROM command_events;

SELECT 'device_commands' AS data_set,
       COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE requested_at_utc IS NOT NULL) AS authoritative_rows,
       COUNT(*) FILTER (WHERE requested_at_utc IS NULL) AS legacy_unknown_rows,
       MIN(requested_at) AS legacy_min_timestamp,
       MAX(requested_at) AS legacy_max_timestamp,
       MIN(requested_at_utc) AS authoritative_min_utc,
       MAX(requested_at_utc) AS authoritative_max_utc
FROM device_commands;

SELECT 'credential_rotations' AS data_set,
       COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE occurred_at_utc IS NOT NULL) AS authoritative_rows,
       COUNT(*) FILTER (WHERE occurred_at_utc IS NULL) AS legacy_unknown_rows,
       MIN(occurred_at) AS legacy_min_timestamp,
       MAX(occurred_at) AS legacy_max_timestamp,
       MIN(occurred_at_utc) AS authoritative_min_utc,
       MAX(occurred_at_utc) AS authoritative_max_utc
FROM credential_rotations;

SELECT 'alerts' AS data_set,
       COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE created_at_utc IS NOT NULL) AS authoritative_created_rows,
       COUNT(*) FILTER (WHERE created_at_utc IS NULL) AS legacy_unknown_created_rows,
       COUNT(*) FILTER (WHERE resolved AND resolved_at_utc IS NOT NULL) AS authoritative_resolved_rows,
       COUNT(*) FILTER (WHERE resolved AND resolved_at_utc IS NULL) AS legacy_unknown_resolved_rows,
       MIN(created_at) AS legacy_min_timestamp,
       MAX(created_at) AS legacy_max_timestamp
FROM alerts;

SELECT 'telemetry_observed_clock_skew' AS data_set,
       COUNT(*) FILTER (WHERE received_at IS NOT NULL AND observed_at IS NOT NULL) AS comparable_rows,
       COUNT(*) FILTER (
           WHERE received_at IS NOT NULL AND observed_at IS NOT NULL
             AND ABS(EXTRACT(EPOCH FROM (received_at - observed_at))) > 30
       ) AS over_30_second_observed_skew_rows,
       MIN(EXTRACT(EPOCH FROM (received_at - observed_at)))
           FILTER (WHERE received_at IS NOT NULL AND observed_at IS NOT NULL) AS min_received_minus_observed_seconds,
       MAX(EXTRACT(EPOCH FROM (received_at - observed_at)))
           FILTER (WHERE received_at IS NOT NULL AND observed_at IS NOT NULL) AS max_received_minus_observed_seconds
FROM device_telemetry_samples;

SELECT 'edge_agent_reported_clock_skew' AS data_set,
       COUNT(*) FILTER (WHERE reported_clock_skew_ms IS NOT NULL) AS comparable_rows,
       COUNT(*) FILTER (WHERE ABS(reported_clock_skew_ms) > 30000) AS over_30_second_skew_rows,
       MIN(reported_clock_skew_ms) AS min_skew_ms,
       MAX(reported_clock_skew_ms) AS max_skew_ms
FROM edge_agents;

\echo 'Sample IDs still lacking authoritative UTC fields (first 100 per data set)'
SELECT 'device_telemetry_samples' AS data_set, id AS row_id, sampled_at AS legacy_timestamp
FROM device_telemetry_samples WHERE received_at IS NULL ORDER BY id LIMIT 100;
SELECT 'activity_events' AS data_set, id AS row_id, occurred_at AS legacy_timestamp
FROM activity_events WHERE occurred_at_utc IS NULL ORDER BY id LIMIT 100;
SELECT 'command_events' AS data_set, id AS row_id, occurred_at AS legacy_timestamp
FROM command_events WHERE occurred_at_utc IS NULL ORDER BY id LIMIT 100;
SELECT 'device_commands' AS data_set, id AS row_id, requested_at AS legacy_timestamp
FROM device_commands WHERE requested_at_utc IS NULL ORDER BY id LIMIT 100;
SELECT 'credential_rotations' AS data_set, id AS row_id, occurred_at AS legacy_timestamp
FROM credential_rotations WHERE occurred_at_utc IS NULL ORDER BY id LIMIT 100;

ROLLBACK;
