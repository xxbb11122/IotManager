#!/usr/bin/env node
// Read-only capacity projection. This does not inspect or change a database.
import fs from 'node:fs';
import process from 'node:process';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const HORIZONS = [30, 90, 365, 730];
const MIN_RETENTION_DAYS = Object.freeze({
  activity_events: 730,
  command_events: 730,
  device_commands: 730,
  alerts: 365,
  site_weather_snapshots: 90,
  site_weather_forecast_points: 30,
  weather_provider_access_events: 730,
  credential_rotations: 730
});
const TELEMETRY_TABLES = new Set([
  'device_telemetry_samples',
  'device_telemetry_samples_archive'
]);

function fail(message) {
  throw new Error(message);
}

function positive(value, name, allowZero = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) ||
      (allowZero ? value < 0 : value <= 0)) {
    fail(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} finite number`);
  }
  return value;
}

function boundedFraction(value, name) {
  positive(value, name);
  if (value > 1) fail(`${name} must not exceed 1`);
  return value;
}

function whole(value, name, allowZero = false) {
  positive(value, name, allowZero);
  if (!Number.isSafeInteger(value)) fail(`${name} must be a safe integer`);
  return value;
}

function bytesAndGiB(value) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    fail('Projected bytes exceed the safe numeric range; split the fleet into smaller models');
  }
  return { bytes: Math.ceil(value), gib: Number((value / GIB).toFixed(3)) };
}

function parseArgs(args) {
  if (args.length !== 2 || args[0] !== '--input') {
    fail('Usage: node scripts/db/retention-capacity-model.mjs --input <measurements.json>');
  }
  return args[1];
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Input must be a JSON object');
  if (input.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (!['illustrative', 'measured'].includes(input.evidenceClass)) {
    fail('evidenceClass must be illustrative or measured');
  }
  if (typeof input.sourceNote !== 'string' || input.sourceNote.trim().length < 8) {
    fail('sourceNote must identify the origin of these measurements or assumptions');
  }
  whole(input.deviceCount, 'deviceCount');
  whole(input.telemetrySamplesPerDevicePerDay, 'telemetrySamplesPerDevicePerDay');
  whole(input.averageStateJsonBytes, 'averageStateJsonBytes', true);
  whole(input.telemetryBaseRowBytes, 'telemetryBaseRowBytes');
  whole(input.nonRetentionDatabaseBytes, 'nonRetentionDatabaseBytes', true);
  positive(input.telemetryHotStorageMultiplier, 'telemetryHotStorageMultiplier');
  positive(input.telemetryArchiveStorageMultiplier, 'telemetryArchiveStorageMultiplier');
  if (input.telemetryHotStorageMultiplier < 1 || input.telemetryArchiveStorageMultiplier < 1) {
    fail('Telemetry storage multipliers must include the base row and be at least 1');
  }
  if (!Array.isArray(input.otherTables)) fail('otherTables must be an array');
  const names = new Set();
  for (const [index, table] of input.otherTables.entries()) {
    const prefix = `otherTables[${index}]`;
    if (!table || typeof table !== 'object' || typeof table.table !== 'string' ||
        !/^[a-z][a-z0-9_]*$/.test(table.table) || names.has(table.table) ||
        TELEMETRY_TABLES.has(table.table)) {
      fail(`${prefix}.table must be a unique SQL-style table name`);
    }
    names.add(table.table);
    whole(table.rowsPerDay, `${prefix}.rowsPerDay`, true);
    whole(table.averageRowBytes, `${prefix}.averageRowBytes`);
    positive(table.storageMultiplier, `${prefix}.storageMultiplier`);
    if (table.storageMultiplier < 1) fail(`${prefix}.storageMultiplier must be at least 1`);
    whole(table.retentionDays, `${prefix}.retentionDays`);
    if (MIN_RETENTION_DAYS[table.table] != null &&
        table.retentionDays < MIN_RETENTION_DAYS[table.table]) {
      fail(`${prefix}.retentionDays cannot shorten the current policy for ${table.table}`);
    }
  }
  for (const name of Object.keys(MIN_RETENTION_DAYS)) {
    if (!names.has(name)) fail(`otherTables must include ${name}`);
  }
  const recovery = input.recovery;
  if (!recovery || typeof recovery !== 'object') fail('recovery measurements are required');
  boundedFraction(recovery.backupCompressionRatio, 'recovery.backupCompressionRatio');
  whole(recovery.observedWalBytesPerDay, 'recovery.observedWalBytesPerDay', true);
  positive(recovery.restoreMiBPerSecond, 'recovery.restoreMiBPerSecond');
  positive(recovery.walReplayMiBPerSecond, 'recovery.walReplayMiBPerSecond');
  positive(recovery.walReplayWindowHours, 'recovery.walReplayWindowHours', true);
  positive(recovery.fixedRecoverySeconds, 'recovery.fixedRecoverySeconds', true);
  if (recovery.walReplayWindowHours > 24) {
    fail('recovery.walReplayWindowHours must be at most 24; model longer outages separately');
  }
}

function project(input) {
  const dailyTelemetryRows = input.deviceCount * input.telemetrySamplesPerDevicePerDay;
  if (!Number.isSafeInteger(dailyTelemetryRows)) fail('dailyTelemetryRows exceeds the safe integer range');
  const telemetryPayloadBytes = input.telemetryBaseRowBytes + input.averageStateJsonBytes;
  const dailyHotBytes = dailyTelemetryRows * telemetryPayloadBytes * input.telemetryHotStorageMultiplier;
  const dailyArchiveBytes = dailyTelemetryRows * telemetryPayloadBytes * input.telemetryArchiveStorageMultiplier;
  const rows = [];
  for (const days of HORIZONS) {
    const hotDays = Math.min(days, 90);
    const archiveDays = Math.max(0, Math.min(days, 365) - 90);
    const tables = {
      device_telemetry_samples: {
        rows: dailyTelemetryRows * hotDays,
        ...bytesAndGiB(dailyHotBytes * hotDays)
      },
      device_telemetry_samples_archive: {
        rows: dailyTelemetryRows * archiveDays,
        ...bytesAndGiB(dailyArchiveBytes * archiveDays)
      }
    };
    for (const table of input.otherTables) {
      const retainedDays = Math.min(days, table.retentionDays);
      const retainedRows = table.rowsPerDay * retainedDays;
      if (!Number.isSafeInteger(retainedRows)) fail(`${table.table} row count exceeds the safe integer range`);
      tables[table.table] = {
        rows: retainedRows,
        ...bytesAndGiB(table.rowsPerDay * table.averageRowBytes * table.storageMultiplier * retainedDays)
      };
    }
    const totalBytes = Object.values(tables).reduce((sum, table) => sum + table.bytes, 0);
    const databaseBytes = totalBytes + input.nonRetentionDatabaseBytes;
    const dailyFullBackupBytes = databaseBytes * input.recovery.backupCompressionRatio;
    const replayBytes = input.recovery.observedWalBytesPerDay * input.recovery.walReplayWindowHours / 24;
    const estimatedRecoverySeconds = input.recovery.fixedRecoverySeconds +
      dailyFullBackupBytes / (input.recovery.restoreMiBPerSecond * MIB) +
      replayBytes / (input.recovery.walReplayMiBPerSecond * MIB);
    rows.push({
      horizonDays: days,
      tables,
      totalTableAndIndexStorage: bytesAndGiB(totalBytes),
      estimatedDatabaseStorage: bytesAndGiB(databaseBytes),
      estimatedDailyFullBackup: bytesAndGiB(dailyFullBackupBytes),
      assumedWalReplayWindowHours: input.recovery.walReplayWindowHours,
      assumedWalReplay: bytesAndGiB(replayBytes),
      estimatedRecoverySeconds: Math.ceil(estimatedRecoverySeconds)
    });
  }
  return {
    schemaVersion: 1,
    evidenceClass: input.evidenceClass,
    sourceNote: input.sourceNote,
    assumptions: input,
    policyDays: { telemetryHot: 90, telemetryTotal: 365, auditAndCommandsMinimum: 730 },
    dailyTelemetryRows,
    observedWalPerDay: bytesAndGiB(input.recovery.observedWalBytesPerDay),
    projections: rows,
    limitations: [
      'These are steady-state arithmetic projections, not measured table sizes or proof of RPO/RTO.',
      'Check pg_total_relation_size, pg_stat_wal, backup archives, restore throughput and lock pressure against production-like measurements.',
      'The model assumes a successful daily full backup and an intact WAL chain; it cannot certify recoverability.',
      'Legal holds, legacy rows and non-terminal records can exceed the nominal retention horizon and must be budgeted separately.'
    ]
  };
}

try {
  const input = JSON.parse(fs.readFileSync(parseArgs(process.argv.slice(2)), 'utf8'));
  validateInput(input);
  process.stdout.write(`${JSON.stringify(project(input), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`retention-capacity-model: ${error.message}\n`);
  process.exitCode = 1;
}
