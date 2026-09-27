/** Runtime motion preference; never alters transforms that encode final state. */
export function createMotionPolicy({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  degraded = false
} = {}) {
  const media = windowObject?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const subscribers = new Set();
  let disposed = false;
  let lowMotion = Boolean(degraded);

  function snapshot() {
    const reduced = Boolean(media?.matches);
    const hidden = Boolean(documentObject?.hidden);
    return { reduced, hidden, degraded: lowMotion, animate: !reduced && !hidden && !lowMotion };
  }

  let previous = snapshot();
  function notify() {
    if (disposed) return;
    const current = snapshot();
    if (Object.keys(current).every(key => current[key] === previous[key])) return;
    previous = current;
    for (const listener of [...subscribers]) listener({ ...current });
  }

  if (media?.addEventListener) media.addEventListener('change', notify);
  else media?.addListener?.(notify);
  documentObject?.addEventListener?.('visibilitychange', notify);

  return {
    snapshot,
    subscribe(listener, { immediate = false } = {}) {
      if (typeof listener !== 'function') throw new TypeError('Motion subscriber must be a function.');
      if (disposed) return () => {};
      subscribers.add(listener);
      if (immediate) listener(snapshot());
      return () => subscribers.delete(listener);
    },
    setDegraded(value) {
      lowMotion = Boolean(value);
      notify();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      if (media?.removeEventListener) media.removeEventListener('change', notify);
      else media?.removeListener?.(notify);
      documentObject?.removeEventListener?.('visibilitychange', notify);
      subscribers.clear();
    }
  };
}
