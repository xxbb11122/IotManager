/**
 * Keeps the weather refresh deadline as business state while exposing each
 * visible second as a lightweight UI tick. It never knows how the app renders.
 */
export function createWeatherRefreshCooldown({
  scheduler = globalThis,
  now = () => Date.now(),
  onDeadlineChange = () => {},
  onTick = () => {}
} = {}) {
  let retryAt = null;
  let timer = null;

  function clearTimer() {
    if (timer !== null) {
      scheduler.clearInterval?.(timer);
      timer = null;
    }
  }

  function publishTick(timestamp = now()) {
    onTick({ retryAt, now: timestamp });
  }

  function clear() {
    clearTimer();
    if (retryAt !== null) {
      retryAt = null;
      onDeadlineChange(retryAt);
    }
    publishTick();
    return retryAt;
  }

  function tick() {
    const timestamp = now();
    if (retryAt === null) {
      publishTick(timestamp);
      return;
    }
    if (timestamp >= retryAt) {
      clearTimer();
      retryAt = null;
      onDeadlineChange(retryAt);
      publishTick(timestamp);
      return;
    }
    publishTick(timestamp);
  }

  function set(seconds) {
    clearTimer();
    const normalized = Math.max(0, Math.ceil(Number(seconds) || 0));
    if (normalized === 0) return clear();

    retryAt = now() + normalized * 1000;
    onDeadlineChange(retryAt);
    tick();
    timer = scheduler.setInterval(tick, 1000);
    return retryAt;
  }

  function getRetryAt() {
    return retryAt;
  }

  return Object.freeze({ set, clear, tick, getRetryAt });
}
