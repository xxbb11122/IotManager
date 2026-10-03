import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskRegistry } from '../src/js/task-state.js';

test('task registry deduplicates a business action across view changes without cancelling it', () => {
  const registry = createTaskRegistry();
  const first = registry.begin('claim', { scopeKey: 'site:A', viewKey: 'lan:1' });
  const duplicate = registry.begin('claim', { scopeKey: 'site:A', viewKey: 'devices:2' });
  assert.equal(first.started, true);
  assert.equal(duplicate.started, false);
  assert.equal(duplicate.task, first.task);
  assert.equal(registry.size, 1);
  assert.equal(registry.isCurrent(first.task), true);
  assert.equal(registry.isCurrent(first.task, { scopeKey: 'site:A', viewKey: 'devices:2' }), false);
  assert.equal(registry.isCurrent(first.task, { scopeKey: 'site:A', viewKey: 'lan:1' }), true);
  assert.ok(Object.isFrozen(first.task));
});

test('a late finish cannot remove a newer request or a different context', () => {
  const registry = createTaskRegistry();
  const first = registry.begin('load', { scopeKey: 'A' }).task;
  const other = registry.begin('load', { scopeKey: 'B' }).task;
  assert.equal(registry.isCurrent(first, { scopeKey: 'B' }), false);
  assert.equal(registry.finish(first), true);
  const newer = registry.begin('load', { scopeKey: 'A' }).task;
  assert.ok(newer.requestId > first.requestId);
  assert.equal(registry.finish(first), false);
  assert.equal(registry.isCurrent(newer), true);
  assert.equal(registry.isCurrent(other), true);
  assert.equal(registry.get('load', 'A'), newer);
});

test('task scope and key cannot collide through delimiter text', () => {
  const registry = createTaskRegistry();
  registry.begin('x:y', { scopeKey: 'z' });
  registry.begin('y', { scopeKey: 'z:x' });
  assert.equal(registry.size, 2);
  assert.equal(registry.isCurrent(null), false);
  assert.equal(registry.finish({ key: 'missing', scopeKey: '' }), false);
  const emptyScope = registry.begin('null-scope', { scopeKey: null, viewKey: null }).task;
  assert.equal(registry.isCurrent(emptyScope, { scopeKey: '', viewKey: '' }), true);
});
