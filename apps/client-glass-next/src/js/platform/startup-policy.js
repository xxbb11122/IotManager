/** Shared semantic startup budgets; Android StartupPolicy is checked by tests. */
export const STARTUP_POLICY = Object.freeze({
  webHoldMs: 160, webExitMs: 360, webExitDeadlineMs: 500,
  nativeHoldMs: 180, nativeExitMs: 340, nativeExitDeadlineMs: 480,
  waitingMs: 500, slowMs: 4000, webRetryMs: 7500,
  nativeTimeoutMs: 8000, nativeRescueMs: 9500,
  optionalReadMs: 1800, prefetchMs: 4000,
  probeDelays: Object.freeze([250, 500, 1000, 1000])
});

export function startupFeatures(env = {}) {
  return Object.freeze({ motion: env.VITE_STARTUP_MOTION !== 'false',
    depth: env.VITE_STARTUP_DEPTH === 'true', blur: env.VITE_STARTUP_BLUR === 'true',
    prefetch: env.VITE_STARTUP_PREFETCH === 'true' });
}

/** Bounded in-memory timings. Never retain URLs, tokens, errors or user data. */
export function createStartupTrace({ now = () => performance.now(), limit = 128 } = {}) {
  const startedAt = now(), events = [];
  const allowed = new Set(['phase', 'owner', 'result', 'task', 'count', 'launchId',
    'activityInstanceId', 'elapsedMs', 'roundTripMs', 'nativeElapsedMs']);
  return Object.freeze({
    record(event, fields = {}) {
      const row = { event, clockDomain: 'web', elapsedMs: Math.max(0, now() - startedAt) };
      for (const [key, value] of Object.entries(fields)) {
        if (allowed.has(key) && (typeof value === 'number' || typeof value === 'boolean'
          || typeof value === 'string' && value.length <= 80)) row[key] = value;
      }
      events.push(Object.freeze(row));
      if (events.length > limit) events.shift();
    },
    snapshot: () => events.map(event => ({ ...event }))
  });
}
