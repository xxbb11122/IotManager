import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.env.IOT_EIGHT_ROOT);
const json = async name => JSON.parse(await readFile(resolve(root, name), 'utf8'));
const phases = {};
let passed = true;
const errors = [];
for (const [name, expected] of Object.entries({ auth: 5, ai: 1, load: 1, 'rollback-write': 1, 'rollback-read': 1 })) {
  try {
    const report = await json(name + '.json');
    const stats = report.stats;
    phases[name] = { passed: false, tests: stats.expected + stats.unexpected + stats.flaky,
      succeeded: stats.expected, failed: stats.unexpected, skipped: stats.skipped, durationMs: stats.duration };
    assert.equal(stats.expected, expected);
    assert.equal(stats.unexpected, 0); assert.equal(stats.skipped, 0); assert.equal(stats.flaky, 0);
    phases[name].passed = true;
  } catch (error) { phases[name] ??= { passed: false, tests: 0 }; passed = false; errors.push(name + ': ' + error.message); }
}
let load, ai, rollback, cleanup, inputs;
async function evidence(name, validate) {
  let value;
  try { value = await json(name); validate(value); }
  catch (error) { passed = false; errors.push(name + ': ' + error.message); }
  return value;
}
inputs = await evidence('inputs.json', () => {});
load = await evidence('load-evidence.json', load => {
  assert.equal(load.result.created, 1000); assert.equal(load.result.failedCreates, 0);
  assert.equal(load.result.websocket.opened, 100); assert.equal(load.result.websocket.errors, 0);
  assert.ok(load.result.websocket.minimumMessages >= 1000);
  assert.equal(load.cleanup.archived, 1000); assert.equal(load.cleanup.failed, 0); assert.equal(load.cleanup.remainingActive, 0);
});
ai = await evidence('ai-evidence.json', ai => {
  assert.equal(ai.chatCalls, 1); assert.equal(ai.embeddingCalls, 0); assert.equal(ai.rejectedCalls, 0); assert.equal(ai.realProviderCalled, false);
});
rollback = await evidence('rollback-evidence.json', rollback => {
  assert.equal(rollback.sameDatabase, true); assert.equal(rollback.sameMigrations, true); assert.equal(rollback.distinctImages, true);
});
cleanup = await evidence('cleanup.json', cleanup => {
  assert.equal(cleanup.passed, true);
});
// Only these structured files are published; fail if a generated password or
// bearer JWT appears in any of them. Traces and browser storage are never kept.
const safeFiles = (await readdir(root)).filter(name => name.endsWith('.json') && name !== 'summary.json');
const secretDirectory = process.env.IOT_SECRET_DIR;
const secrets = secretDirectory ? await readdir(secretDirectory).catch(() => []) : [];
for (const name of safeFiles) {
  const path = resolve(root, name);
  let text = await readFile(path, 'utf8');
  let redacted = false;
  for (const file of secrets) {
    const secret = (await readFile(resolve(secretDirectory, file), 'utf8')).trim();
    if (secret.length >= 8 && text.includes(secret)) { text = text.replaceAll(secret, '[REDACTED]'); redacted = true; }
  }
  text = text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, () => { redacted = true; return '[REDACTED_JWT]'; });
  if (redacted) { await writeFile(path, text); passed = false; errors.push('Sensitive evidence redacted: ' + name); }
}
const summary = { passed, completedAt: new Date().toISOString(), scenarios: 8,
  playwrightExecutions: Object.values(phases).reduce((sum, row) => sum + (row.tests ?? 0), 0),
  phases, inputs, ai, load, rollback, cleanup,
  errors: errors.map(value => value.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')),
  boundaries: ['Isolated service and site-dashboard integration; not a Glass APK real-account acceptance run.',
    'Mock AI supplier; no real-provider quality or billing acceptance.',
    'N-to-N-1 uses distinct development source commits, not approved immutable production releases.',
    'Load measurements apply only to this runner.'] };
await writeFile(resolve(root, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ passed, scenarios: 8, phases, errors: summary.errors }));
if (!passed) process.exitCode = 1;
