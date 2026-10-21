import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const main = url => process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href;
export function args(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv, options = {};
  for (let i = 0; i < rest.length; i += 2) {
    assert.match(rest[i], /^--[a-z-]+$/);
    assert.ok(rest[i + 1] && !rest[i + 1].startsWith('--'), `Missing ${rest[i]} value`);
    assert.ok(!Object.hasOwn(options, rest[i].slice(2)), 'Duplicate option');
    options[rest[i].slice(2)] = rest[i + 1];
  }
  return {command, options};
}
export function run(command, argv, options = {}) {
  try { return execFileSync(command, argv, {encoding:'utf8', windowsHide:true, maxBuffer:16*1024*1024,
    stdio:['pipe','pipe','pipe'], ...options}); }
  catch { throw new Error(`${command} failed; private command output was withheld`); }
}
export const gh = (endpoint, options = {}) => JSON.parse(run('gh', ['api', endpoint], options));
export function report(output, value) {
  if (output) { mkdirSync(dirname(resolve(output)), {recursive:true}); writeFileSync(resolve(output), JSON.stringify(value,null,2)+'\n', {mode:0o600}); }
  console.log(JSON.stringify(value,null,2));
}
export function repository(value) { assert.match(value??'', /^[\w.-]+\/[\w.-]+$/); return value; }
export function fail(error) { console.error(error.message); process.exitCode = 1; }
