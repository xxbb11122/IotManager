export const STARTUP_READ_TIMEOUT_MS = 1800;

/** Stop waiting at the deadline; the underlying read must have no side effects. */
export function boundedStartupRead(read, { timeoutMs = STARTUP_READ_TIMEOUT_MS,
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
    Promise.resolve().then(() => settled ? undefined : read()).then(
      value => finish({ status: 'fulfilled', value }), error => finish({ status: 'rejected', error }));
  });
}

/** Read independently and apply the snapshots only after checking their context. */
export async function readStartupSnapshot(readers, options = {}) {
  return Object.fromEntries(await Promise.all(Object.entries(readers).map(async ([key, read]) =>
    [key, await boundedStartupRead(read, options)])));
}
