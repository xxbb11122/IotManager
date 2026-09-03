const DEFAULT_COUNTERS = Object.freeze({
  fullRenderCount: 0,
  devicePatchCount: 0,
  weatherPatchCount: 0,
  forecastPatchCount: 0,
  runtimePatchCount: 0,
  commandPatchCount: 0,
  activityPatchCount: 0,
  alertPatchCount: 0,
  countdownPatchCount: 0,
  maxPatchBatchSize: 0
});

/**
 * Small, dependency-free counters used by the partial-render migration.  They
 * are intentionally quiet in production; callers may opt into `log()` while
 * diagnosing a device or browser session.
 */
export function createRenderMetrics({ logger = globalThis.console } = {}) {
  const counters = { ...DEFAULT_COUNTERS };

  function increment(name, amount = 1) {
    if (!Object.hasOwn(counters, name)) return 0;
    const numericAmount = Number(amount);
    counters[name] += Number.isFinite(numericAmount) ? numericAmount : 1;
    return counters[name];
  }

  function recordBatch(size) {
    const numericSize = Number(size);
    if (Number.isFinite(numericSize) && numericSize > counters.maxPatchBatchSize) {
      counters.maxPatchBatchSize = numericSize;
    }
    return counters.maxPatchBatchSize;
  }

  function snapshot() {
    return Object.freeze({ ...counters });
  }

  function reset() {
    Object.assign(counters, DEFAULT_COUNTERS);
  }

  function log(label = '[UI_METRICS]') {
    const value = snapshot();
    if (typeof logger?.debug === 'function') logger.debug(label, value);
    return value;
  }

  return Object.freeze({ increment, recordBatch, snapshot, reset, log });
}
