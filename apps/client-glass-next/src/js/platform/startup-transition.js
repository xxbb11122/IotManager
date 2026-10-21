import { STARTUP_POLICY } from './startup-policy.js';

export const STARTUP_VISUAL_TARGET_MS = STARTUP_POLICY.webHoldMs;
export const STARTUP_EXIT_MS = STARTUP_POLICY.webExitMs;
export function startupHoldMs(elapsedVisibleMs) {
  return Math.max(0, STARTUP_VISUAL_TARGET_MS - Math.max(0, elapsedVisibleMs));
}

/** One visual owner. A cancelled/error attempt never unlocks the device UI. */
export function createStartupTransition({
  overlay = document.getElementById('startup-overlay'),
  appRoot = document.getElementById('app'), view = window, nativeVisual = null,
  trace = null, features = { motion: true, depth: false, blur: false }
} = {}) {
  const doc = view.document, media = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const now = () => view.performance?.now?.() ?? Date.now();
  const bootAt = view.__iotStartupWatchdog?.startedAt ?? now();
  const visibleAt = Number.isFinite(view.__iotStartupFirstFrameAt) ? view.__iotStartupFirstFrameAt : bootAt;
  let phase = 'loading', owner = nativeVisual ? 'native' : 'web', launch = null;
  let done = null, settle = null, nativeListener = null, exiting = false, reduced = false;
  let timer = null, holdTimer = null, exitTimer = null, frameOne = null, frameTwo = null;
  let transitionListener = null, generation = 0;
  const terminal = () => ['interactive', 'error', 'disposed'].includes(phase);
  const motion = () => features.motion !== false && !media?.matches && !reduced && !doc?.hidden;
  const shellReady = () => Boolean(appRoot?.querySelector('.app-shell'));
  const mark = next => {
    phase = next;
    if (doc?.documentElement?.dataset) doc.documentElement.dataset.startupPhase = phase;
    trace?.record(next, { phase, owner });
  };
  function clear() {
    for (const id of [timer, holdTimer, exitTimer]) if (id !== null) view.clearTimeout(id);
    for (const id of [frameOne, frameTwo]) if (id !== null) view.cancelAnimationFrame(id);
    timer = holdTimer = exitTimer = frameOne = frameTwo = null;
    if (transitionListener) overlay?.removeEventListener('transitionend', transitionListener);
    transitionListener = null;
  }
  function removeListener() {
    const handle = nativeListener; nativeListener = null;
    Promise.resolve(handle?.remove?.()).catch(() => {});
  }
  function releaseMotionListeners() {
    media?.removeEventListener?.('change', motionChanged);
    doc?.removeEventListener?.('visibilitychange', motionChanged);
  }
  function finish() {
    if (terminal() || !shellReady()) return false;
    if (view.__iotStartupWatchdog?.snapshot?.().state === 'error') return fail();
    clear(); removeListener(); releaseMotionListeners();
    mark('interactive');
    view.__iotStartupWatchdog?.stop?.();
    overlay?.remove?.();
    if (appRoot) { appRoot.inert = false; appRoot.removeAttribute('aria-hidden'); }
    settle?.(true);
    return true;
  }
  function fail() {
    if (terminal()) return false;
    clear(); removeListener(); releaseMotionListeners();
    mark('error');
    if (overlay) {
      // Retain a Web cover behind native recovery, also safe if the bridge died
      // before handoff and Android already released to the Web fallback.
      overlay.hidden = false;
      overlay.classList?.remove('startup-overlay--leaving');
    }
    if (appRoot) { appRoot.inert = true; appRoot.setAttribute('aria-hidden', 'true'); }
    view.__iotStartupWatchdog?.fail?.();
    settle?.(false);
    return false;
  }
  const matches = value => Boolean(launch && value?.launchId === launch.launchId
    && (!launch.activityInstanceId || value.activityInstanceId === launch.activityInstanceId));
  function finishNativeExit(value) {
    if (typeof value !== 'object') value = { launchId: value };
    if (terminal() || owner !== 'native' || !matches(value)) return false;
    return finish();
  }
  function hideForNative() {
    if (!overlay || terminal()) return false;
    overlay.hidden = true;
    return true;
  }
  function startWebExit() {
    if (terminal() || exiting || doc?.hidden) return;
    exiting = true; mark('web_exiting');
    if (!overlay) { finish(); return; }
    overlay.hidden = false;
    if (!motion()) { finish(); return; }
    frameOne = view.requestAnimationFrame(() => {
      frameTwo = view.requestAnimationFrame(() => {
        if (terminal()) return;
        const fade = () => {
          if (terminal()) return;
          transitionListener = event => {
            if (event.target === overlay && event.propertyName === 'opacity') finish();
          };
          overlay.addEventListener('transitionend', transitionListener);
          overlay.classList.add('startup-overlay--leaving');
          exitTimer = view.setTimeout(finish, STARTUP_POLICY.webExitDeadlineMs);
        };
        holdTimer = view.setTimeout(fade, Math.max(0, visibleAt + STARTUP_VISUAL_TARGET_MS - now()));
      });
    });
  }
  function identity() {
    return { launchId: launch.launchId, ...(launch.activityInstanceId ? { activityInstanceId: launch.activityInstanceId } : {}) };
  }
  function motionChanged() {
    if (doc?.documentElement?.dataset) doc.documentElement.dataset.startupMotion = motion() ? 'on' : 'off';
    if (terminal()) return;
    if (owner === 'web' && done) {
      if (doc?.hidden) { clear(); exiting = false; overlay?.classList.remove('startup-overlay--leaving'); mark('web_covering'); }
      else if (!motion()) finish();
      else startWebExit();
    }
    if (owner === 'native' && launch) {
      Promise.resolve(nativeVisual?.setMotionPolicy?.({ ...identity(), reducedMotion: !motion() })).catch(() => {});
    }
  }
  function useWeb() {
    if (terminal()) return;
    owner = 'web';
    view.__iotStartupWatchdog?.setOwner?.('web');
    if (overlay) overlay.hidden = false;
    startWebExit();
  }
  async function queryAtDeadline(ticket) {
    if (terminal() || ticket !== generation) return;
    view.clearTimeout(timer);
    // The query itself may hang: a bounded timer still enters recovery.
    timer = view.setTimeout(fail, 500);
    try {
      const state = await nativeVisual.getLaunchState();
      if (terminal() || ticket !== generation || launch && !matches(state)) return;
      if (!launch) launch = state;
      if (state?.phase === 'COMPLETE' && state.coverRemoved === true) finish();
      else if (state?.phase === 'WEB_FALLBACK') { clear(); useWeb(); }
      else fail();
    } catch { fail(); }
  }
  async function beginNativeExit(ticket) {
    const at = now();
    timer = view.setTimeout(() => { void queryAtDeadline(ticket); }, Math.max(0, STARTUP_POLICY.nativeRescueMs - (at - bootAt)));
    try {
      const handle = await nativeVisual.addExitListener(finishNativeExit);
      if (terminal() || ticket !== generation) { await handle?.remove?.(); return; }
      nativeListener = handle;
      const state = await nativeVisual.getLaunchState();
      if (terminal() || ticket !== generation) return;
      launch = state;
      trace?.record('native_clock_anchor', { ...identity(), nativeElapsedMs: state.elapsedMs, roundTripMs: now() - at });
      if (state?.phase === 'WEB_FALLBACK') { clear(); useWeb(); return; }
      if (state?.phase === 'COMPLETE' && state.coverRemoved === true) { finish(); return; }
      if (!['COVERING', 'EXITING'].includes(state?.phase) || !(state.remainingWebRescueMs > 0)) { fail(); return; }
      view.clearTimeout(timer);
      timer = view.setTimeout(() => { void queryAtDeadline(ticket); }, state.remainingWebRescueMs);
      hideForNative();
      if (state.phase === 'EXITING') return;
      mark('native_preparing');
      const result = await nativeVisual.prepareReveal({ ...identity(), reducedMotion: !motion() });
      if (!terminal() && ticket === generation && result?.accepted !== true) await queryAtDeadline(ticket);
    } catch {
      // No evidence that the cover is gone: never unlock on a blind timer.
      if (!terminal() && ticket === generation) trace?.record('native_bridge_unavailable');
    }
  }
  function markUiReady() {
    if (done) return done;
    if (terminal() || !shellReady() || view.__iotStartupWatchdog?.snapshot?.().state === 'error') return Promise.resolve(false);
    done = new Promise(resolve => { settle = resolve; });
    trace?.record('local_ui_ready');
    if (nativeVisual) { mark('native_covering'); void beginNativeExit(++generation); }
    else { mark('web_covering'); startWebExit(); }
    return done;
  }
  function notifyStartupFailure() {
    const old = launch;
    fail();
    if (nativeVisual) void (async () => {
      try {
        const state = old ?? await nativeVisual.getLaunchState();
        if (phase !== 'error') return;
        await nativeVisual.failStartup?.({ launchId: state.launchId, activityInstanceId: state.activityInstanceId });
      } catch { /* Native timeout remains authoritative. */ }
    })();
  }
  function dispose() {
    if (phase === 'disposed') return;
    generation++; clear(); removeListener(); releaseMotionListeners();
    if (phase !== 'interactive') { mark('disposed'); settle?.(false); }
  }
  function setMotionPolicy(policy = {}) { reduced = Boolean(policy.reduced || policy.degraded); motionChanged(); }

  view.__iotStartupWatchdog?.setOwner?.(owner);
  media?.addEventListener?.('change', motionChanged);
  doc?.addEventListener?.('visibilitychange', motionChanged);
  if (doc?.documentElement?.dataset) {
    doc.documentElement.dataset.startupDepth = String(features.depth === true);
    doc.documentElement.dataset.startupBlur = String(features.blur === true);
  }
  motionChanged();
  if (nativeVisual?.reportWebCoverReady) void (async () => {
    try {
      if (!view.__iotStartupWatchdog?.setOwner) return;
      const img = overlay?.querySelector?.('img');
      if (img && !img.complete) await img.decode?.();
      if (terminal()) return;
      const state = await nativeVisual.getLaunchState();
      if (terminal()) return;
      await nativeVisual.reportWebCoverReady({ launchId: state.launchId, activityInstanceId: state.activityInstanceId,
        reducedMotion: !motion() });
    } catch { /* Bounded native probes cover pre-module/image/bridge failures. */ }
  })();
  return Object.freeze({ markUiReady, hideForNative, finishNativeExit, restoreFallback: fail,
    notifyStartupFailure, setMotionPolicy, dispose,
    snapshot: () => ({ phase, owner, launchId: launch?.launchId, activityInstanceId: launch?.activityInstanceId }) });
}
