// The visual target is intentionally shorter than a mandatory splash delay.
// A ready shell can add at most 180ms of hold before the 220ms exit.
export const STARTUP_VISUAL_TARGET_MS = 450;
export const STARTUP_READY_HOLD_LIMIT_MS = 180;
const EXIT_FALLBACK_MS = 320;

export function startupHoldMs(elapsedVisibleMs, elapsedReadyMs) {
  return Math.max(0, Math.min(
    STARTUP_VISUAL_TARGET_MS - Math.max(0, elapsedVisibleMs),
    STARTUP_READY_HOLD_LIMIT_MS - Math.max(0, elapsedReadyMs)
  ));
}

/** The launch layer is separate from the app root so the first UI render cannot remove it. */
export function createStartupTransition({
  overlay = document.getElementById('startup-overlay'),
  appRoot = document.getElementById('app'),
  view = window
} = {}) {
  let leaving = false;
  let removed = false;
  const firstFrameAt = view.__iotStartupFirstFrameAt;
  let visibleAt = Number.isFinite(firstFrameAt) ? firstFrameAt : (view.performance?.now?.() ?? Date.now());
  let readyAt = null;
  let visualFrame = null;
  let firstFrame = null;
  let secondFrame = null;
  let readyTimer = null;
  let holdTimer = null;
  let fallbackTimer = null;
  const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)');

  const now = () => view.performance?.now?.() ?? Date.now();
  if (!Number.isFinite(firstFrameAt)) {
    visualFrame = view.requestAnimationFrame((timestamp) => {
      visibleAt = Number.isFinite(timestamp) ? timestamp : now();
    });
  }

  function onVisibilityChange() {
    if (leaving && view.document?.hidden) removeOverlay();
  }

  function onReducedMotionChange(event) {
    if (leaving && event.matches) removeOverlay();
  }

  function removeOverlay() {
    if (removed) return;
    removed = true;
    if (visualFrame !== null) view.cancelAnimationFrame(visualFrame);
    if (firstFrame !== null) view.cancelAnimationFrame(firstFrame);
    if (secondFrame !== null) view.cancelAnimationFrame(secondFrame);
    if (readyTimer !== null) view.clearTimeout(readyTimer);
    if (holdTimer !== null) view.clearTimeout(holdTimer);
    if (fallbackTimer !== null) view.clearTimeout(fallbackTimer);
    view.document?.removeEventListener?.('visibilitychange', onVisibilityChange);
    reducedMotion?.removeEventListener?.('change', onReducedMotionChange);
    overlay?.remove();
    if (appRoot) {
      appRoot.inert = false;
      appRoot.removeAttribute('aria-hidden');
    }
  }

  function beginExit() {
    if (removed) return;
    if (view.document?.hidden || reducedMotion?.matches) {
      removeOverlay();
      return;
    }
    overlay.addEventListener('transitionend', (event) => {
      if (event.target === overlay && event.propertyName === 'opacity') removeOverlay();
    }, { once: true });
    overlay.classList.add('startup-overlay--leaving');
    // transitionend is not guaranteed after backgrounding or stylesheet changes.
    fallbackTimer = view.setTimeout(removeOverlay, EXIT_FALLBACK_MS);
  }

  function markUiReady() {
    if (leaving || removed || !appRoot?.querySelector('.app-shell')) return false;
    leaving = true;
    view.__iotStartupWatchdog?.stop?.();
    readyAt = now();
    if (!overlay || view.document?.hidden || reducedMotion?.matches) {
      removeOverlay();
      return true;
    }

    view.document?.addEventListener?.('visibilitychange', onVisibilityChange);
    reducedMotion?.addEventListener?.('change', onReducedMotionChange);
    const webPaintOpportunity = new Promise((resolve) => {
      firstFrame = view.requestAnimationFrame(() => {
        secondFrame = view.requestAnimationFrame(resolve);
      });
    });
    const visualGateTimeout = new Promise((resolve) => {
      readyTimer = view.setTimeout(resolve, STARTUP_READY_HOLD_LIMIT_MS);
    });
    void Promise.race([
      webPaintOpportunity,
      visualGateTimeout
    ]).then(() => {
      if (removed) return;
      if (readyTimer !== null) view.clearTimeout(readyTimer);
      const hold = startupHoldMs(now() - visibleAt, now() - readyAt);
      if (hold > 0) holdTimer = view.setTimeout(beginExit, hold);
      else beginExit();
    });
    return true;
  }

  function dispose() {
    view.__iotStartupWatchdog?.stop?.();
    removeOverlay();
  }

  return Object.freeze({ markUiReady, dispose });
}
