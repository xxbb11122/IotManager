import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This launcher requires an ephemeral GitHub runner');
assert.match(process.env.IOT_COMPOSE_PROJECT ?? '', /^iot-manager-eight-\d+$/);
const root = resolve(process.env.IOT_EIGHT_ROOT);
const environment = resolve(process.env.IOT_ENVIRONMENT_FILE);
const state = resolve(process.env.IOT_RUNTIME_STATE_FILE);
assert.equal(environment, resolve(state, '../integration.env'));
await mkdir(root, { recursive: true });
await mkdir(resolve(state, '..'), { recursive: true });
const template = (await readFile('deploy/.env.integration.example', 'utf8')).replace(/\r\n/g, '\n');
await writeFile(environment, template.replace(/^IOT_SECRET_DIR=.*$/m, 'IOT_SECRET_DIR=' + process.env.IOT_SECRET_DIR));
// Keep teardown usable if identity bootstrap fails before writing subjects.
await writeFile(state, '', { flag: 'wx' });
const caddy = (await readFile('deploy/Caddyfile.integration', 'utf8')).replace(/\r\n/g, '\n');
await writeFile(resolve(root, 'Caddyfile'), caddy + '\nhttps://ai-fixture.test {\n\ttls internal\n\treverse_proxy ai-fixture:8081\n}\n');
await writeFile(resolve(root, 'inputs.json'), JSON.stringify({
  checkedOutCommit: process.env.GITHUB_SHA,
  nMinusOneCommit: 'e0977e77220773182df4e3a73741686cbb87c6d9',
  sourceReleaseApproval: false,
  project: process.env.IOT_COMPOSE_PROJECT,
  deviceCount: 1000, websocketCount: 100, concurrency: 25,
  frontend: 'site-dashboard', apkRetestedInThisRun: false,
  startedAt: new Date().toISOString()
}, null, 2));
