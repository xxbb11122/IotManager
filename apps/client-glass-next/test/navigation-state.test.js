import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavigationState, navigationRouteKey } from '../src/js/navigation-state.js';

const route = (screen, entityId = null, scopeKey = 'site:A') => ({ screen, entityId, scopeKey });

test('nested task pages return to their actual source and restore reading position', () => {
  const navigation = createNavigationState(route('activity'));
  navigation.savePosition({ scrollY: 310, focus: { id: 'activity-d1' } });
  assert.equal(navigation.navigate(route('detail', 'd1')).kind, 'push');
  navigation.savePosition({ scrollY: 150 });
  navigation.navigate(route('weather'));
  assert.equal(navigation.back().route.screen, 'detail');
  const source = navigation.back();
  assert.equal(source.route.screen, 'activity');
  assert.equal(source.position.scrollY, 310);
  assert.equal(source.position.focus.id, 'activity-d1');
  assert.equal(source.canGoBack, false);
  assert.equal(navigation.back().changed, false);
});

test('peer pages retain their own positions without retaining a stale detail stack', () => {
  const navigation = createNavigationState(route('devices'));
  navigation.savePosition({ scrollY: 230 });
  navigation.navigate(route('detail', 'd1'));
  navigation.navigate(route('activity'), { kind: 'peer' });
  assert.equal(navigation.canGoBack, false);
  navigation.savePosition({ scrollY: 600 });
  const devices = navigation.navigate(route('devices'), { kind: 'peer' });
  assert.equal(devices.position.scrollY, 230);
  assert.equal(navigation.navigate(route('activity'), { kind: 'peer' }).position.scrollY, 600);
});

test('same-screen entities are separate routes and repeated same entity is not navigation', () => {
  const navigation = createNavigationState(route('detail', 'd1'));
  navigation.savePosition({ scrollY: 120 });
  const change = navigation.navigate(route('detail', 'd2'));
  assert.equal(change.changed, true);
  assert.equal(change.position.scrollY, 0);
  assert.equal(navigation.navigate(route('detail', 'd2')).changed, false);
  assert.equal(navigation.back().position.scrollY, 120);
});

test('context changes discard incompatible navigation and cannot be revived by browser history', () => {
  const navigation = createNavigationState(route('devices'));
  navigation.savePosition({ scrollY: 120 });
  navigation.navigate(route('detail', 'd1'));
  const old = navigation.snapshot();
  const next = navigation.navigate(route('devices', null, 'site:B'));
  assert.equal(next.kind, 'context-replace');
  assert.equal(next.canGoBack, false);
  assert.equal(next.position.scrollY, 0);
  assert.equal(navigation.restore(old), null);
  assert.equal(navigation.current.scopeKey, 'site:B');
});

test('history restoration uses live saved positions newer than its snapshot', () => {
  const navigation = createNavigationState(route('devices'));
  const previous = navigation.snapshot();
  navigation.savePosition({ scrollY: 410 });
  navigation.navigate(route('weather'));
  const restored = navigation.restore(JSON.parse(JSON.stringify(previous)));
  assert.equal(restored.kind, 'back');
  assert.equal(restored.position.scrollY, 410);
  assert.equal(restored.route.screen, 'devices');
  assert.equal(navigation.restore({ version: 2 }), null);
  assert.doesNotThrow(() => navigation.restore({ version: 1, current: route('devices'), stack: [null, {}, route('activity')], positions: [['invalid', null]] }));
});

test('snapshot and position mutations cannot corrupt route state', () => {
  const navigation = createNavigationState(route('devices'));
  const position = { scrollY: -2, focus: { id: 'one' } };
  navigation.savePosition(position);
  position.focus.id = 'two';
  const snapshot = navigation.snapshot();
  assert.equal(snapshot.positions[0][1].scrollY, 0);
  assert.equal(snapshot.positions[0][1].focus.id, 'one');
  snapshot.current.screen = 'not-real';
  assert.equal(navigation.current.screen, 'devices');
  assert.notEqual(navigationRouteKey(route('detail', 'a:b')), navigationRouteKey(route('detail:a', 'b')));
});

test('replace preserves the real parent instead of adding a transient page to Back', () => {
  const navigation = createNavigationState(route('add'));
  navigation.navigate(route('lan'));
  navigation.navigate(route('detail', 'd1'), { kind: 'replace' });
  assert.equal(navigation.back().route.screen, 'add');
  assert.throws(() => navigation.navigate(route('weather'), { kind: 'unexpected' }), TypeError);
});
