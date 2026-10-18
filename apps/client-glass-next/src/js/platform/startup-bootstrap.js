import { STARTUP_POLICY } from './startup-policy.js';

/** A deadline stops waiting, not the underlying read. Late results are inert. */
export function boundedStartupRead(read, { timeoutMs = STARTUP_POLICY.optionalReadMs,
  scheduler = globalThis, signal = null } = {}) {
  return new Promise(resolve => {
    let settled = false, timer;
    const finish = result => {
      if (settled) return;
      settled = true;
      scheduler.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => finish({ status: 'cancelled' });
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    timer = scheduler.setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
    Promise.resolve().then(() => settled ? undefined : read()).then(value => finish({ status: 'fulfilled', value }),
      error => finish({ status: 'rejected', error }));
  });
}

/** Only readers here; callers apply snapshots in dependency order. */
export async function readStartupSnapshot(readers, { trace = null, ...options } = {}) {
  const rows = await Promise.allSettled(Object.entries(readers).map(async ([key, read]) => {
    trace?.record('local_read_started', { task: key });
    const result = await boundedStartupRead(read, options);
    trace?.record('local_read_settled', { task: key, result: result.status,
      count: Array.isArray(result.value) ? result.value.length : undefined });
    return [key, result];
  }));
  return Object.fromEntries(rows.filter(row => row.status === 'fulfilled').map(row => row.value));
}

/** Single-flight speculative reads: no state mutations, handled rejection, abort. */
export function createStartupPrefetch({ scheduler = globalThis, trace = null } = {}) {
  let active = null;
  function cancel() { const old = active; active = null; old?.controller.abort(); }
  return Object.freeze({
    start(key, read) {
      if (active?.key === key) return active.promise;
      cancel();
      const controller = new AbortController(), entry = { key, controller, promise: null };
      trace?.record('prefetch_started');
      entry.promise = boundedStartupRead(() => read(controller.signal), {
        timeoutMs: STARTUP_POLICY.prefetchMs, scheduler, signal: controller.signal
      }).then(result => {
        if (result.status === 'timeout') controller.abort();
        trace?.record('prefetch_settled', { result: result.status });
        return active === entry ? result : { status: 'cancelled' };
      });
      active = entry;
      return entry.promise;
    },
    take(key) {
      if (active?.key !== key) return null;
      const entry = active;
      return entry.promise.then(result => {
        if (active !== entry) return { status: 'cancelled' };
        active = null;
        return result;
      });
    },
    cancel
  });
}
