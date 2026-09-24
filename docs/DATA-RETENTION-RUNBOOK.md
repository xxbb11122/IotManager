# R1 Data Retention Runbook

This runbook governs the R1 bounded retention executor. It does not authorize
changes to the approved 90-day hot telemetry, 365-day total telemetry, or
two-year audit/command baselines.

## Safety model

- The Backend uses `received_at` from the authoritative UTC clock for every
  retention boundary. Rows without an authoritative timestamp are treated as
  legacy and are not automatically removed. The API surfaces these rows as
  `LEGACY_UNKNOWN`; the database trust/time columns intentionally remain null
  until individually reviewed evidence justifies reconciliation. V20 does not
  rewrite a potentially large telemetry table during deployment.
- Telemetry is copied to `device_telemetry_samples_archive` before its hot
  copy is deleted. `source_sample_id` is unique, so a retried batch is safe.
  Authoritatively timed hot rows already older than 365 days are also copied
  and verified first, then become eligible for the same pass's archive purge;
  a backlog must not remain forever merely because it missed the 90–365-day
  archive window.
  Before deleting hot rows, the same batch re-reads the archived rows and
  verifies source-key coverage and a SHA-256 fingerprint over IDs, device,
  timestamps/trust, source and payload. Verification failure rolls back the
  batch and retains the hot copies.
- Each category batch is a separate transaction. Its category watermark is
  committed only after that batch completes. If a run reaches its bounded
  batch limit or is interrupted, its next invocation continues from that
  category watermark.
- A complete pass clears the watermark. This is intentional: data skipped by
  a legal/investigation hold is reconsidered after the hold is released.
- A short database row lock plus a bounded lease ensures only one Backend
  replica executes the scheduled retention pass. The lease is renewed before
  every bounded batch, and each batch has a transaction timeout. A lost
  process naturally releases the work after the lease expires.
- Hold create/release and each destructive batch lock the same seeded
  `retention-hold-guard` row. A hold committed before a batch obtains the
  guard is included in that batch's fresh snapshot; the worker does not use
  one stale hold snapshot for an entire multi-batch run.
- The production default is disabled and dry-run. Enabling destructive work
  requires the review sequence below.

## Configuration

```yaml
iot:
  retention:
    enabled: false                 # scheduler off until approval
    dry-run: true                  # records evidence but changes no rows
    schedule: "0 30 2 * * *"       # UTC
    batch-size: 5000               # maximum 1..5000
    lock-lease: 45m
    batch-timeout: 2m            # lock-lease must exceed twice this value
    capacity-sample-ms: 600000   # periodic table/age gauges
```

Environment equivalents are `IOT_RETENTION_ENABLED`,
`IOT_RETENTION_DRY_RUN`, `IOT_RETENTION_SCHEDULE`,
`IOT_RETENTION_BATCH_SIZE`, `IOT_RETENTION_LOCK_LEASE`, and
`IOT_RETENTION_BATCH_TIMEOUT`.

`iot_retention_table_bytes{table}` includes PostgreSQL table, index and TOAST
storage; `iot_retention_oldest_age_seconds{table}` uses the oldest known
timestamp. A value of `-1` means the measurement is unavailable or there is
no authoritative row. H2 development mode does not expose PostgreSQL storage
bytes. These gauges are sampled even while destructive retention is disabled
so the dry-run capacity review has a baseline.

Do not lower fixed retention durations through an ad-hoc runtime override.
The Backend rejects an override below the 90/365-day telemetry and two-year
audit/command minimums. Any change needs the relevant product/data owner,
security, DBA and change approval record plus a reviewed code change.

## Controlled enablement

1. Take and verify a fresh PostgreSQL backup. Confirm the WAL-G/PITR chain
   still meets the approved recovery target.
2. Run `scripts/db/legacy-time-reconciliation.sql` against a protected,
   read-only production snapshot. Store the report in the approved restricted
   evidence location. Do not bulk shift legacy wall-clock values by eight
   hours or infer a timezone from the machine's current setting.
3. Deploy with `enabled=true` and `dry-run=true`. Review at least two scheduled
   runs in `retention_job_runs`: category, selected window, estimates, held
   rows, cursor and duration must match the expected capacity model.
4. Create and release test holds for a device, site, command and category.
   Confirm held data is not archived/deleted and becomes eligible only after
   its hold is released.
5. Review lock waits, database connection-pool pressure, API latency, backup
   duration and retention metrics during a dry-run at production-like volume.
6. Obtain the recorded approval to set `dry-run=false`. Enable execution only
   in the protected deployment configuration; never by an emergency shell
   edit or a mobile/client request.
7. After the first destructive pass, compare archived/deleted counts with the
   preceding dry-run and repeat the isolated physical recovery drill.

## Holds and evidence

Create and release holds through the protected `/api/v1/retention/holds`
surface. Every hold action creates an immutable, actor-attributed audit row in
`retention_hold_events`; it is not a device `activity_events` row because a
global or category hold has no device. Site/device/command holds require access to that
scope; platform-wide and category holds require the owner role. A retention
hold with an unknown category is rejected rather than silently offering no
protection. Valid categories are `TELEMETRY`, `ACTIVITY_EVENTS`,
`COMMAND_EVENTS`, `COMMANDS`, `ALERTS`, `WEATHER_SNAPSHOTS`,
`WEATHER_FORECASTS`, `WEATHER_PROVIDER_AUDIT`, and
`CREDENTIAL_ROTATIONS`. A retention
pass records one correlation ID across its category rows in
`retention_job_runs`; capture the run ID, policy version, time window, count
summary, watermark, operator/change reference, and relevant backup identifier
in the release or operations record.

Live history reads only the hot table. Long-range retrieval uses the separate
`GET /api/v1/devices/{id}/telemetry/archive` endpoint with required `from`
and `to` ISO-8601 times, at most a 31-day window, `limit` 1–500, and the
returned `nextReceivedAt`/`nextId` keyset cursor. Production applies a
separate five-requests-per-minute archive-read limit per principal; callers
must not use the archive route for live dashboards.

An active alert, non-terminal command, current credential rotation, unknown
legacy timestamp, or matching hold is a reason to keep data. Do not bypass
that protection by deleting from SQL directly.
For weather snapshots the retention worker protects at most the newest row
per site, not the newest row for every historical configuration fingerprint;
old location/provider configurations cannot accumulate immortal snapshots.

## Interruption and failure response

- A failed batch does not advance its watermark. Investigate the error,
  capacity and database health; then allow the next scheduled pass or a
  controlled rerun to resume.
- If a pass ended at its bounded batch limit, that category's watermark remains
  until a future pass completes. This is normal at high volume.
- To reconcile a `LEGACY_UNKNOWN` row, preserve the read-only report, identify
  its source/system timezone from contemporaneous evidence, get DBA and data
  owner approval, and update only the reviewed row set through a separately
  recorded migration. Without defensible provenance, leave the UTC fields null
  and retain the row; never fabricate `received_at` from a guessed offset.
- If a task lease remains after a crashed node, wait for its configured lease
  to expire; do not delete `scheduled_task_locks` by hand unless an incident
  record and DBA review establish that no worker is active.
- If archive correctness is in doubt, stop destructive execution
  (`IOT_RETENTION_DRY_RUN=true`), preserve the job evidence, and restore only
  through the approved recovery runbook. Application rollback is not a data
  recovery mechanism.

## Capacity review inputs

Before enabling execution, record: device count, samples/device/day, average
`state_json` size, index expansion factor, projected hot/archive/audit table
sizes at 30/90/365/730 days, daily backup size, WAL generation rate, batch
duration, lock wait, and projected recovery time. Re-evaluate these values
when device count or telemetry cardinality materially changes.

The read-only model in `scripts/db/retention-capacity-model.mjs` accepts a
versioned JSON input and emits 30/90/365/730-day projections as JSON. Start
from `docs/retention-capacity-input.example.json`, but replace its explicitly
illustrative figures with measurements from a production-like load run or a
protected database snapshot. Record `pg_total_relation_size` (including
indexes and TOAST), actual rows/day, compressed backup size, WAL bytes/day,
measured restore/replay throughput and the source of each value. Run:

```bash
node scripts/db/retention-capacity-model.mjs --input path/to/reviewed-measurements.json \
  > path/to/restricted-capacity-report.json
```

The input and output must be stored in the approved restricted evidence
location; do not commit real production measurements or identifiers. The
model caps hot telemetry at 90 days, archived telemetry at 365 total days,
and audit/command rows at no less than 730 days. It accounts for the measured
non-retention database footprint, backup compression and a declared WAL replay
window, but it cannot prove
RPO/RTO or an intact WAL chain. A physical restore and PITR drill remain
mandatory after destructive retention is enabled. Holds, unknown legacy
timestamps and open records may make actual storage exceed the projection.
