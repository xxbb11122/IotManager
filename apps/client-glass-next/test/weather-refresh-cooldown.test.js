import assert from 'node:assert/strict';
import test from 'node:test';

import { createWeatherRefreshCooldown } from '../src/js/weather-refresh-cooldown.js';

function fakeClock() {
  let timestamp = 1_000;
  const timers = [];
  return {
    timers,
    now: () => timestamp,
    advance(ms) { timestamp += ms; },
    scheduler: {
      setInterval(callback, delay) {
        const timer = { callback, delay, cancelled: false };
        timers.push(timer);
        return timer;
      },
      clearInterval(timer) { timer.cancelled = true; }
    },
    runIntervals() {
      for (const timer of timers) {
        if (!timer.cancelled) timer.callback();
      }
    }
  };
}

test('weather cooldown publishes deadline changes once and emits lightweight ticks', () => {
  const clock = fakeClock();
  const deadlines = [];
  const ticks = [];
  const cooldown = createWeatherRefreshCooldown({
    scheduler: clock.scheduler,
    now: clock.now,
    onDeadlineChange: (deadline) => deadlines.push(deadline),
    onTick: (tick) => ticks.push(tick)
  });

  const retryAt = cooldown.set(3);
  assert.equal(retryAt, 4_000);
  assert.deepEqual(deadlines, [4_000]);
  assert.equal(ticks.length, 1);

  clock.advance(1_000);
  clock.runIntervals();
  clock.advance(1_000);
  clock.runIntervals();
  assert.equal(deadlines.length, 1);
  assert.equal(ticks.at(-1).retryAt, 4_000);

  clock.advance(1_000);
  clock.runIntervals();
  assert.deepEqual(deadlines, [4_000, null]);
  assert.equal(ticks.at(-1).retryAt, null);
  assert.equal(cooldown.getRetryAt(), null);
});

test('starting a new cooldown cancels the preceding interval', () => {
  const clock = fakeClock();
  const cooldown = createWeatherRefreshCooldown({ scheduler: clock.scheduler, now: clock.now });
  cooldown.set(60);
  cooldown.set(30);
  assert.equal(clock.timers.length, 2);
  assert.equal(clock.timers[0].cancelled, true);
  assert.equal(clock.timers[1].cancelled, false);
  assert.equal(cooldown.getRetryAt(), 31_000);
});
