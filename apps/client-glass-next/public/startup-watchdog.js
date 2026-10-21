/* Classic bootstrap guard: works even when the application module cannot load. */
(() => {
  const overlay = document.getElementById('startup-overlay'), app = document.getElementById('app');
  const status = document.getElementById('startup-status'), retry = document.getElementById('startup-retry');
  const startedAt = performance.now();
  let owner = window.Capacitor?.getPlatform?.() === 'android' || window.androidBridge ? 'native' : 'web';
  let state = 'waiting';
  const timers = [];
  const terminal = () => ['completed', 'error', 'disposed'].includes(state);
  app.inert = true; app.setAttribute('aria-hidden', 'true');
  document.documentElement.dataset.startupPhase = 'loading';
  document.documentElement.dataset.startupOwner = owner;
  window.__iotStartupFirstFrameAt = null;
  requestAnimationFrame(timestamp => { window.__iotStartupFirstFrameAt = timestamp; });
  function clear() { for (const timer of timers) clearTimeout(timer); timers.length = 0; }
  function show(message, canRetry = false) {
    if (status) { status.textContent = message; status.hidden = false; }
    if (retry) retry.hidden = !canRetry;
  }
  function update() {
    if (terminal()) return;
    const elapsed = performance.now() - startedAt;
    if (owner === 'web' && elapsed >= 7500) {
      state = 'retryAvailable'; show('界面仍在准备，可以继续等待或重新加载。', true);
    } else if (elapsed >= 4000) {
      state = 'slow'; show('启动时间较长，正在准备本地界面…');
    } else if (elapsed >= 500) show('正在准备设备运营界面…');
  }
  function fail() {
    if (terminal()) return;
    state = 'error'; clear();
    document.documentElement.dataset.startupPhase = 'error';
    if (overlay) { overlay.hidden = false; overlay.classList.remove('startup-overlay--leaving'); }
    app.inert = true; app.setAttribute('aria-hidden', 'true');
    show('界面启动未完成，请重新加载。', true);
  }
  const moduleError = event => {
    if (event.target?.tagName === 'SCRIPT' && event.target.type === 'module'
      || event.target === window && event.error) fail();
  };
  window.addEventListener('error', moduleError, true);
  retry?.addEventListener('click', () => {
    if (retry.disabled) return;
    retry.disabled = true; state = 'disposed'; clear(); window.location.reload();
  });
  for (const delay of [500, 4000, 7500]) timers.push(setTimeout(update, delay));
  const img = overlay?.querySelector('img');
  function coverReady() { if (overlay) overlay.dataset.coverReady = 'true'; }
  function imageFailed() {
    if (img) img.hidden = true;
    const fallback = document.getElementById('startup-image-fallback');
    if (fallback) fallback.hidden = false;
    coverReady();
  }
  img?.addEventListener('load', coverReady, { once: true });
  img?.addEventListener('error', imageFailed, { once: true });
  if (img?.complete) { if (img.naturalWidth > 0) coverReady(); else imageFailed(); }
  window.__iotStartupWatchdog = Object.freeze({
    startedAt,
    stop() {
      if (state === 'error' || state === 'disposed') return;
      state = 'completed'; clear(); window.removeEventListener('error', moduleError, true);
    },
    fail,
    setOwner(value) {
      if (terminal() || !['native', 'web'].includes(value)) return;
      owner = value; document.documentElement.dataset.startupOwner = value; update();
    },
    snapshot: () => ({ state, owner, elapsedMs: performance.now() - startedAt })
  });
})();
