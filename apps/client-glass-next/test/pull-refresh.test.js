import assert from 'node:assert/strict';
import test from 'node:test';
import { createPullRefreshState } from '../src/js/pull-refresh.js';

function arm(pull, pointerId = 1) {
  pull.start({ pointerId, x: 10, y: 20 });
  return pull.move({ pointerId, x: 10, y: 180 });
}

test('only a valid downward armed release starts a request', () => {
  const pull = createPullRefreshState();
  assert.equal(arm(pull).phase, 'armed');
  const released = pull.release({ pointerId: 1 });
  assert.equal(released.refresh, true);
  assert.equal(released.phase, 'refreshing');
  assert.equal(released.distance, 72);
  assert.equal(pull.release({ pointerId: 1 }).refresh, false);
  assert.equal(pull.settle(released.requestId).phase, 'idle');
});

test('pointer cancellation then a tap never inherits the previous armed distance', () => {
  const pull = createPullRefreshState();
  arm(pull);
  assert.equal(pull.release({ pointerId: 1, cancelled: true }).refresh, false);
  assert.equal(pull.snapshot().distance, 0);
  assert.equal(pull.start({ pointerId: 2, x: 10, y: 20 }).distance, 0);
  assert.equal(pull.release({ pointerId: 2 }).refresh, false);
});

test('refresh requests remain mutually exclusive even after a page-leave cancellation', () => {
  const pull = createPullRefreshState();
  arm(pull);
  const first = pull.release({ pointerId: 1 });
  assert.equal(pull.cancel().phase, 'refreshing');
  arm(pull, 2);
  assert.equal(pull.release({ pointerId: 2 }).refresh, false);
  pull.settle(first.requestId);
  arm(pull, 3);
  const second = pull.release({ pointerId: 3 });
  assert.equal(second.refresh, true);
  assert.ok(second.requestId > first.requestId);
  assert.equal(pull.settle(first.requestId).phase, 'refreshing');
  assert.equal(pull.settle(second.requestId).phase, 'idle');
});

test('horizontal or initial upward intent locks the gesture out until a fresh pointerdown', () => {
  const pull = createPullRefreshState();
  pull.start({ pointerId: 1, x: 0, y: 0 });
  assert.equal(pull.move({ pointerId: 1, x: 40, y: 20 }).phase, 'idle');
  pull.move({ pointerId: 1, x: 40, y: 300 });
  assert.equal(pull.release({ pointerId: 1 }).refresh, false);
  pull.start({ pointerId: 2, x: 0, y: 100 });
  assert.equal(pull.move({ pointerId: 2, x: 0, y: 80 }).phase, 'idle');
});

test('reversing an armed drag unarms it before release', () => {
  const pull = createPullRefreshState();
  arm(pull);
  const reversed = pull.move({ pointerId: 1, x: 10, y: 50 });
  assert.equal(reversed.armed, false);
  assert.equal(reversed.distance, 15);
  assert.equal(pull.release({ pointerId: 1 }).refresh, false);
});

test('non-owning fingers and ineligible targets cannot trigger a refresh', () => {
  const pull = createPullRefreshState();
  for (const exclusion of [{ pointerType: 'mouse' }, { isPrimary: false }, { eligible: false }, { atTop: false }]) {
    assert.equal(pull.start({ pointerId: 1, ...exclusion }).phase, 'idle');
    assert.equal(pull.release({ pointerId: 1 }).refresh, false);
  }
  arm(pull);
  pull.start({ pointerId: 2, x: 10, y: 20 });
  assert.equal(pull.snapshot().pointerId, 1);
  assert.equal(pull.release({ pointerId: 2 }).refresh, false);
  assert.equal(pull.release({ pointerId: 1 }).refresh, true);
});

test('leaving the page top or cancelling a drag resets pointer and distance', () => {
  const pull = createPullRefreshState();
  arm(pull);
  assert.equal(pull.move({ pointerId: 1, x: 10, y: 200, atTop: false }).phase, 'idle');
  assert.equal(pull.release({ pointerId: 1 }).refresh, false);
  arm(pull, 2);
  assert.equal(pull.cancel().distance, 0);
  assert.equal(pull.release({ pointerId: 2 }).refresh, false);
});

test('slop and clamping are deterministic and invalid thresholds are rejected', () => {
  const pull = createPullRefreshState();
  pull.start({ pointerId: 1 });
  assert.equal(pull.move({ pointerId: 1, y: 4 }).distance, 0);
  assert.equal(pull.move({ pointerId: 1, y: 1000 }).distance, 100);
  assert.throws(() => createPullRefreshState({ maximum: 20 }), TypeError);
  assert.throws(() => createPullRefreshState({ maximum: Infinity }), TypeError);
});
