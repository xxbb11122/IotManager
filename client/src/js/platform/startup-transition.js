export const STARTUP_VISUAL_TARGET_MS = 700;
export const STARTUP_EXIT_MS = 280;
const EXIT_FALLBACK_MS = STARTUP_EXIT_MS + 120;
const NATIVE_BRIDGE_FALLBACK_MS = 9000;

export function startupHoldMs(elapsedVisibleMs) {
  return Math.max(0, STARTUP_VISUAL_TARGET_MS - Math.max(0, elapsedVisibleMs));
}

/** The overlay is retained until the native cover has actually left the screen. */
export function createStartupTransition({
  overlay = document.getElementById('startup-overlay'),
  appRoot = document.getElementById('app'),
  view = window,
  nativeVisual = null
} = {}) {
  const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const firstFrameAt = view.__iotStartupFirstFrameAt;
  const visibleAt = Number.isFinite(firstFrameAt) ? firstFrameAt : (view.performance?.now?.() ?? Date.now());
  const now = () => view.performance?.now?.() ?? Date.now();
  let started = false;
  let finished = false;
  let fallbackRestored = false;
  let nativeHidden = false;
  let currentLaunchId = null;
  let completion = null;
  let finishPromise = null;
  let rescueTimer = null;
  let holdTimer = null;
  let exitTimer = null;
  let frameOne = null;
  let frameTwo = null;
  let nativeListener = null;

  function clearTimers() {
    if (rescueTimer !== null) view.clearTimeout(rescueTimer);
    if (holdTimer !== null) view.clearTimeout(holdTimer);
    if (exitTimer !== null) view.clearTimeout(exitTimer);
    if (frameOne !== null) view.cancelAnimationFrame(frameOne);
    if (frameTwo !== null) view.cancelAnimationFrame(frameTwo);
    rescueTimer = holdTimer = exitTimer = frameOne = frameTwo = null;
  }

  function releaseNativeListener() {
    void nativeListener?.remove?.();
    nativeListener = null;
  }

  function finish(visibleHome) {
    if (finished) return;
    finished = true;
    clearTimers();
    releaseNativeListener();
    view.__iotStartupWatchdog?.stop?.();
    overlay?.remove?.();
    if (appRoot) {
      appRoot.inert = false;
      appRoot.removeAttribute('aria-hidden');
    }
    completion?.(visibleHome);
  }

  function restoreFallback({ failed = true, settle = true } = {}) {
    if (finished || fallbackRestored) return;
    fallbackRestored = true;
    clearTimers();
    releaseNativeListener();
    currentLaunchId = null;
    nativeHidden = false;
    if (overlay) {
      overlay.hidden = false;
      overlay.classList?.remove?.('startup-overlay--leaving');
    }
    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute?.('aria-hidden', 'true');
    }
    if (failed) view.__iotStartupWatchdog?.fail?.();
    if (settle) completion?.(false);
  }

  function hideForNative() {
    if (!overlay || finished) return false;
    nativeHidden = true;
    overlay.hidden = true;
    return true;
  }

  function finishNativeExit(launchId) {
    if (!nativeHidden || currentLaunchId !== launchId) return false;
    finish(true);
    return true;
  }

  function beginWebExit() {
    if (finished) return;
    if (!overlay || view.document?.hidden || reducedMotion?.matches) {
      finish(true);
      return;
    }
    const fadeAt = visibleAt + STARTUP_VISUAL_TARGET_MS;
    const startFade = () => {
      if (finished) return;
      overlay.addEventListener('transitionend', (event) => {
        if (event.target === overlay && event.propertyName === 'opacity') finish(true);
      }, { once: true });
      overlay.classList.add('startup-overlay--leaving');
      exitTimer = view.setTimeout(() => finish(true), EXIT_FALLBACK_MS);
    };
    frameOne = view.requestAnimationFrame(() => {
      frameTwo = view.requestAnimationFrame(() => {
        const remaining = Math.max(0, fadeAt - now());
        if (remaining > 0) holdTimer = view.setTimeout(startFade, remaining);
        else startFade();
      });
    });
  }

  async function beginNativeExit() {
    let obtainedLaunch = false;
    try {
      nativeListener = await nativeVisual.addExitListener(({ launchId }) => finishNativeExit(launchId));
      const launch = await nativeVisual.getLaunchState();
      obtainedLaunch = true;
      if (finished) return;
      if (launch?.phase === 'WEB_FALLBACK') {
        beginWebExit();
        return;
      }
      if (launch?.phase !== 'COVERING' || launch.remainingWebRescueMs <= 0) {
        restoreFallback();
        return;
      }
      currentLaunchId = launch.launchId;
      if (!hideForNative()) {
        restoreFallback();
        return;
      }
      rescueTimer = view.setTimeout(() => restoreFallback(), launch.remainingWebRescueMs);
      const result = await nativeVisual.prepareReveal({
        launchId: currentLaunchId,
        reducedMotion: Boolean(reducedMotion?.matches)
      });
      if (!finished && nativeHidden && result?.accepted !== true) restoreFallback();
    } catch {
      if (finished) return;
      restoreFallback({ failed: obtainedLaunch, settle: obtainedLaunch });
      if (!obtainedLaunch) {
        // No handoff was requested; Android releases to the retained Web cover.
        holdTimer = view.setTimeout(beginWebExit, NATIVE_BRIDGE_FALLBACK_MS);
      }
    }
  }

  function markUiReady() {
    if (started || finished || !appRoot?.querySelector('.app-shell')) return Promise.resolve(false);
    started = true;
    finishPromise = new Promise((resolve) => { completion = resolve; });
    if (nativeVisual) void beginNativeExit();
    else beginWebExit();
    return finishPromise;
  }

  function dispose() {
    clearTimers();
    releaseNativeListener();
    if (!finished) finish(false);
  }

  return Object.freeze({ markUiReady, hideForNative, finishNativeExit, restoreFallback, dispose });
}
