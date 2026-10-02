/**
 * Owns presentation requests, not their business side effects. Leaving a view
 * never aborts an already submitted command; consumers check view ownership
 * before presenting its result and still record the business receipt normally.
 */
export function createTaskRegistry() {
  const active = new Map();
  let sequence = 0;

  function identity(key, scopeKey) {
    return JSON.stringify([String(scopeKey ?? ''), String(key)]);
  }

  function isCurrent(task, context = {}) {
    if (!task || active.get(identity(task.key, task.scopeKey)) !== task) return false;
    if (Object.hasOwn(context, 'scopeKey') && String(context.scopeKey ?? '') !== task.scopeKey) return false;
    if (Object.hasOwn(context, 'viewKey') && String(context.viewKey ?? '') !== task.viewKey) return false;
    return true;
  }

  return {
    begin(key, { scopeKey = '', viewKey = '', phase = 'running' } = {}) {
      const slot = identity(key, scopeKey);
      const existing = active.get(slot);
      if (existing) return { task: existing, started: false };
      const task = Object.freeze({
        key: String(key), scopeKey: String(scopeKey ?? ''), viewKey: String(viewKey ?? ''),
        requestId: ++sequence, phase
      });
      active.set(slot, task);
      return { task, started: true };
    },
    isCurrent,
    get(key, scopeKey = '') {
      return active.get(identity(key, scopeKey)) ?? null;
    },
    finish(task) {
      if (!isCurrent(task)) return false;
      active.delete(identity(task.key, task.scopeKey));
      return true;
    },
    get size() { return active.size; }
  };
}
