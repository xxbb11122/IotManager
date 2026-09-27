import assert from 'node:assert/strict';
import test from 'node:test';

import { commandMotionKind, navigationMotionKind } from '../src/js/motion.js';

test('page motion distinguishes tabs, hierarchy, return, and redraws', () => {
  assert.equal(navigationMotionKind(null, 'devices'), null);
  assert.equal(navigationMotionKind('devices', 'devices'), null);
  assert.equal(navigationMotionKind('devices', 'activity'), 'peer');
  assert.equal(navigationMotionKind('devices', 'add'), 'peer');
  assert.equal(navigationMotionKind('devices', 'detail'), 'forward');
  assert.equal(navigationMotionKind('add', 'ble'), 'forward');
  assert.equal(navigationMotionKind('ble', 'add'), 'back');
  assert.equal(navigationMotionKind('weather', 'devices'), 'back');
  assert.equal(navigationMotionKind('sites', 'devices'), 'peer');
  assert.equal(navigationMotionKind('detail', 'activity', 'peer'), 'peer');
  assert.equal(navigationMotionKind('devices', 'detail', 'forward'), 'forward');
  assert.equal(navigationMotionKind('detail', 'detail', 'context'), 'context');
  assert.equal(navigationMotionKind(null, 'devices', 'context'), null);
});

test('only an existing command changing to a terminal result gets outcome motion', () => {
  const pending = { id: 'c1', status: 'PENDING' };
  assert.equal(commandMotionKind(null, pending), null);
  assert.equal(commandMotionKind(pending, { id: 'c1', status: 'SENT' }), null);
  assert.equal(commandMotionKind(pending, { id: 'c1', status: 'ACKNOWLEDGED' }), 'confirmed');
  assert.equal(commandMotionKind({ id: 'c1', status: 'SENT' }, { id: 'c1', status: 'FAILED' }), 'outcome');
  assert.equal(commandMotionKind({ id: 'c1', status: 'SENT' }, { id: 'c1', status: 'UNCONFIRMED' }), 'outcome');
  assert.equal(commandMotionKind(pending, { id: 'c2', status: 'ACKNOWLEDGED' }), null);
});
