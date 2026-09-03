import { CHANGE_DOMAIN } from './store.js';

const DEFAULT_BATCH_WINDOW_MS = 150;

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function metadataRequiresFullRender(metadata) {
  return !metadata
    || metadata.structural === true
    || !Array.isArray(metadata.domains)
    || metadata.domains.length === 0
    || metadata.domains.includes(CHANGE_DOMAIN.STRUCTURE);
}

/**
 * Coalesces store publications into a single DOM patch per short burst.  The
 * coordinator deliberately treats unknown metadata as a full render, so a
 * newly added state change cannot silently leave stale UI behind.
 */
export function createRenderCoordinator({
  fullRender,
  patchDevices,
  patchWeather,
  patchForecast,
  patchWeatherSettings,
  patchRuntime,
  patchScreen,
  patchCommands,
  patchActivity,
  patchAlerts,
  scheduler = globalThis,
  metrics = null,
  batchWindowMs = DEFAULT_BATCH_WINDOW_MS
} = {}) {
  if (typeof fullRender !== 'function') {
    throw new TypeError('createRenderCoordinator requires a fullRender callback.');
  }

  let latestSnapshot = null;
  let flushTimer = null;
  let fullRenderRequired = false;
  let fullRenderReason = null;
  let visible = true;
  const dirtyDomains = new Set();
  const dirtyEntityRefs = new Set();

  function clearScheduledFlush() {
    if (flushTimer !== null) {
      scheduler.clearTimeout?.(flushTimer);
      flushTimer = null;
    }
  }

  function clearDirtyState() {
    fullRenderRequired = false;
    fullRenderReason = null;
    dirtyDomains.clear();
    dirtyEntityRefs.clear();
  }

  function scheduleFlush(delay = batchWindowMs) {
    if (!visible || flushTimer !== null) return;
    flushTimer = scheduler.setTimeout(() => {
      flushTimer = null;
      flush();
    }, Math.max(0, Number(delay) || 0));
  }

  function enqueue(snapshot, metadata = undefined) {
    latestSnapshot = snapshot;
    if (metadataRequiresFullRender(metadata)) {
      fullRenderRequired = true;
      fullRenderReason = metadata?.reason ?? 'unknown_change';
      scheduleFlush(0);
      return;
    }

    for (const domain of arrayOf(metadata.domains)) dirtyDomains.add(domain);
    for (const reference of arrayOf(metadata.entityRefs)) {
      if (reference !== null && reference !== undefined) dirtyEntityRefs.add(String(reference));
    }
    scheduleFlush();
  }

  function invokePatch(callback, metricName, args) {
    if (typeof callback !== 'function') return true;
    const result = callback(...args);
    if (result !== false) metrics?.increment(metricName);
    return result !== false;
  }

  function flush() {
    clearScheduledFlush();
    if (!latestSnapshot || !visible) return false;

    const snapshot = latestSnapshot;
    if (fullRenderRequired) {
      const reason = fullRenderReason ?? 'structural_change';
      clearDirtyState();
      metrics?.increment('fullRenderCount');
      fullRender(snapshot, reason);
      return true;
    }

    const domains = new Set(dirtyDomains);
    const entityRefs = [...dirtyEntityRefs];
    clearDirtyState();
    if (domains.size === 0) return false;

    metrics?.recordBatch(entityRefs.length || domains.size);
    let patched = true;
    try {
      if (domains.has(CHANGE_DOMAIN.DEVICES) || domains.has(CHANGE_DOMAIN.DEVICE_DETAIL)) {
        patched = invokePatch(patchDevices, 'devicePatchCount', [entityRefs, snapshot]) && patched;
      }
      if (domains.has(CHANGE_DOMAIN.WEATHER)) {
        patched = invokePatch(patchWeather, 'weatherPatchCount', [snapshot]) && patched;
      }
      if (domains.has(CHANGE_DOMAIN.WEATHER_FORECAST)) {
        patched = invokePatch(patchForecast, 'forecastPatchCount', [snapshot]) && patched;
      }
      if (domains.has(CHANGE_DOMAIN.WEATHER_SETTINGS)) {
        patched = invokePatch(patchWeatherSettings, 'weatherPatchCount', [snapshot]) && patched;
      }
      if (domains.has(CHANGE_DOMAIN.RUNTIME) || domains.has(CHANGE_DOMAIN.CONNECTION)) {
        patched = invokePatch(patchRuntime, 'runtimePatchCount', [snapshot]) && patched;
      }
      if (domains.has(CHANGE_DOMAIN.COMMANDS)) {
        patched = invokePatch(patchCommands, 'commandPatchCount', [entityRefs, snapshot]) && patched;
      }
      if (domains.has(CHANGE_DOMAIN.ACTIVITY)) {
        patched = invokePatch(patchActivity, 'activityPatchCount', [entityRefs, snapshot]) && patched;
      }
      if (domains.has(CHANGE_DOMAIN.ALERTS)) {
        patched = invokePatch(patchAlerts, 'alertPatchCount', [entityRefs, snapshot]) && patched;
      }
      if (domains.has(CHANGE_DOMAIN.SCREEN)) {
        patched = invokePatch(patchScreen, 'runtimePatchCount', [snapshot]) && patched;
      }
    } catch {
      patched = false;
    }

    // A single failed region may require a complete rebuild, but only once for
    // this batch. This prevents missing anchors from becoming a render loop.
    if (!patched) {
      metrics?.increment('fullRenderCount');
      fullRender(snapshot, 'patch_target_missing');
    }
    return patched;
  }

  function forceFull(reason = 'forced_render', snapshot = latestSnapshot) {
    clearScheduledFlush();
    clearDirtyState();
    if (!snapshot) return false;
    latestSnapshot = snapshot;
    metrics?.increment('fullRenderCount');
    fullRender(snapshot, reason);
    return true;
  }

  function setVisibility(nextVisible) {
    visible = Boolean(nextVisible);
    if (visible && (fullRenderRequired || dirtyDomains.size > 0)) scheduleFlush(0);
  }

  function destroy() {
    clearScheduledFlush();
    clearDirtyState();
    latestSnapshot = null;
  }

  return Object.freeze({
    enqueue,
    flush,
    forceFull,
    setVisibility,
    metrics: () => metrics?.snapshot?.() ?? Object.freeze({}),
    destroy
  });
}
