/** One in-flight read per active scope; failed automatic reads also cool down. */
export function createSnapshotRefreshGate({ now = () => performance.now(), cooldownMs = 120000, metrics = null } = {}) {
  let active = null;
  return Object.freeze({
    reset() { active = null; },
    run(scope, operation, { automatic = false } = {}) {
      if (active?.scope !== scope) active = { scope, attemptedAt: null, pending: null };
      const entry = active;
      if (entry.pending) {
        metrics?.increment('snapshotJoinedCount');
        return entry.pending;
      }
      if (automatic && entry.attemptedAt !== null && now() - entry.attemptedAt < cooldownMs) {
        metrics?.increment('snapshotCooldownCount');
        return Promise.resolve(null);
      }
      entry.attemptedAt = now();
      metrics?.increment(automatic ? 'snapshotAutomaticCount' : 'snapshotExplicitCount');
      let accept;
      let reject;
      const result = new Promise((resolve, fail) => { accept = resolve; reject = fail; });
      const pending = result.finally(() => {
        if (entry.pending === pending) entry.pending = null;
      });
      entry.pending = pending;
      // Capture the caller's context synchronously; make reentrant reads join it.
      try { accept(operation()); } catch (error) { reject(error); }
      return pending;
    }
  });
}
