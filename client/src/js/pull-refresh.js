/** Pointer-only mechanics. The UI owns exclusions, event listeners and requests. */
export function createPullRefreshState({ threshold = 72, maximum = 100, damping = 0.5, slop = 8, axisRatio = 1.2 } = {}) {
  if (![threshold, maximum, damping, slop, axisRatio].every(Number.isFinite)
    || !(threshold > 0 && maximum >= threshold && damping > 0 && slop >= 0 && axisRatio >= 1)) {
    throw new TypeError('Invalid pull-refresh thresholds.');
  }
  let phase = 'idle';
  let pointerId = null;
  let originX = 0;
  let originY = 0;
  let direction = null;
  let distance = 0;
  let sequence = 0;
  let requestId = null;

  function snapshot() {
    return { phase, pointerId, distance, armed: phase === 'armed', requestId };
  }

  function reset() {
    phase = 'idle';
    pointerId = null;
    originX = 0;
    originY = 0;
    direction = null;
    distance = 0;
    requestId = null;
    return snapshot();
  }

  function cancel() {
    return phase === 'refreshing' ? snapshot() : reset();
  }

  return {
    snapshot,
    start({ pointerId: id, pointerType = 'touch', isPrimary = true, x = 0, y = 0, atTop = true, eligible = true } = {}) {
      if (phase === 'refreshing') return snapshot();
      // A second finger cannot replace the pointer already owning the gesture.
      if (pointerId !== null && pointerId !== id) return snapshot();
      reset();
      if (!eligible || !atTop || !isPrimary || !['touch', 'pen'].includes(pointerType) || id == null) return snapshot();
      pointerId = id;
      originX = Number(x) || 0;
      originY = Number(y) || 0;
      phase = 'dragging';
      return snapshot();
    },
    move({ pointerId: id, x = 0, y = 0, atTop = true } = {}) {
      if (pointerId === null || id !== pointerId || phase === 'refreshing') return snapshot();
      if (!atTop) return reset();
      const dx = (Number(x) || 0) - originX;
      const dy = (Number(y) || 0) - originY;
      if (direction === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < slop) return snapshot();
        if (Math.abs(dx) >= Math.abs(dy) || dy < 0) return reset();
        if (dy < Math.abs(dx) * axisRatio) return snapshot();
        direction = 'vertical';
      }
      distance = Math.min(maximum, Math.max(0, dy) * damping);
      phase = distance >= threshold ? 'armed' : 'dragging';
      return snapshot();
    },
    release({ pointerId: id, cancelled = false } = {}) {
      if (pointerId === null || id !== pointerId || phase === 'refreshing') return { ...snapshot(), refresh: false };
      if (cancelled || phase !== 'armed') return { ...reset(), refresh: false };
      phase = 'refreshing';
      pointerId = null;
      distance = threshold;
      requestId = ++sequence;
      return { ...snapshot(), refresh: true };
    },
    cancel,
    settle(id) {
      if (phase !== 'refreshing' || id !== requestId) return snapshot();
      // Motion may animate this distance change; completion never waits on CSS.
      return reset();
    }
  };
}
