import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [phase, container] = process.argv.slice(2);
assert.match(phase, /^(n|n-minus-one)$/); assert.match(container, /^[a-f0-9]{64}$/);
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, 'Runtime snapshot command failed: ' + args[0]);
  return result.stdout.trim();
}
const inspected = JSON.parse(docker(['inspect', container]))[0];
const environment = Object.fromEntries(inspected.Config.Env.map(entry => {
  const equal = entry.indexOf('='); return [entry.slice(0, equal), entry.slice(equal + 1)];
}).filter(([name]) => ['TZ', 'IOT_TIME_LEGACY_ZONE'].includes(name)));
const jvmZone = docker(['exec', container, 'java', '-cp', '/tmp', 'JvmZoneProbe']);
const wallClock = docker(['exec', container, 'date', '-Iseconds']);
writeFileSync(process.env.IOT_EIGHT_ROOT + '/' + phase + '-runtime.json', JSON.stringify({ phase,
  image: inspected.Image, environment, jvmZone, wallClock }, null, 2));
