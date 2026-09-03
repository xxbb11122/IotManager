const DEFAULT_COUNTERS = Object.freeze({
  wsConnectCount: 0,
  wsDisconnectCount: 0,
  wsReconnectCount: 0,
  restReconcileCount: 0,
  devicePatchCount: 0,
  weatherPatchCount: 0,
  alertPatchCount: 0,
  chartPatchCount: 0
});

export function createRenderMetrics({ logger = globalThis.console } = {}) {
  const counters = { ...DEFAULT_COUNTERS };
  return Object.freeze({
    increment(name, amount = 1) {
      if (!Object.prototype.hasOwnProperty.call(counters, name)) return 0;
      counters[name] += Number.isFinite(Number(amount)) ? Number(amount) : 1;
      return counters[name];
    },
    snapshot() {
      return Object.freeze({ ...counters });
    },
    log(label = '[UI_METRICS]') {
      const value = Object.freeze({ ...counters });
      logger?.debug?.(label, value);
      return value;
    }
  });
}
