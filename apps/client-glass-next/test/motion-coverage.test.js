import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOTION_SCENARIOS } from '../src/dev/motion-preview/scenarios.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const sorted = values => [...new Set(values)].sort();
const matches = (text, expression) => [...text.matchAll(expression)].map(match => match[1]);

test('motion register exactly matches all click branches and input fields, not just a count', () => {
  const source = read('src/js/ui.js');
  const register = read('docs/CLIENT-MOTION-COVERAGE-REGISTER.md');
  const actions = source.slice(source.indexOf('  onClick(event) {'), source.indexOf('  onInput(event) {'));
  assert.deepEqual(sorted(matches(actions, /case '([^']+)'/g)), sorted(matches(register, /\| A\d+ \| `([^`]+)`/g)));
  const fields = source.slice(source.indexOf('  onInput(event) {'), source.indexOf('  supportsPullRefresh() {'));
  assert.deepEqual(sorted(matches(fields, /(?:field|dataset\.field) === '([^']+)'/g)), sorted(matches(register, /\| F\d+ \| `([^`]+)`/g)));
});

test('42 preview IDs match every acceptance row and retain all 18 cross-case definitions', () => {
  const acceptance = read('docs/CLIENT-MOTION-PREFLIGHT-AND-ACCEPTANCE.md');
  const expected = [['G', 11], ['P', 20], ['C', 11]].flatMap(([prefix, length]) => Array.from({ length }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`));
  assert.equal(MOTION_SCENARIOS.length, 42);
  assert.deepEqual(sorted(MOTION_SCENARIOS.map(scene => scene.id)), sorted(expected));
  assert.deepEqual(sorted(matches(acceptance, /^\| ([GPC]\d{2}) \|/gm)), sorted(expected));
  assert.deepEqual(sorted(matches(acceptance, /^\| (X\d{2}) \|/gm)), Array.from({ length: 18 }, (_, index) => `X${String(index + 1).padStart(2, '0')}`));
});

test('motion implementation documents have no broken relative file links', () => {
  for (const name of ['CLIENT-MOTION-DEVELOPMENT-PLAN.md', 'CLIENT-MOTION-PREFLIGHT-AND-ACCEPTANCE.md', 'CLIENT-MOTION-COVERAGE-REGISTER.md', 'CLIENT-MOTION-IMPLEMENTATION-REPORT.md', 'CLIENT-MOTION-FULL-COVERAGE-FRAMEWORK.md']) {
    const source = read(`docs/${name}`);
    for (const link of matches(source, /\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(link)) continue;
      const target = link.split('#')[0];
      assert.equal(existsSync(resolve(root, 'docs', target)), true, `${name}: ${target}`);
    }
  }
});
