/** The launch layer is separate from the app root so the first UI render cannot remove it. */
export function createStartupTransition({
  overlay = document.getElementById('startup-overlay'),
  appRoot = document.getElementById('app'),
  view = window
} = {}) {
  let leaving = false;
  let removed = false;
  let firstFrame = null;
  let secondFrame = null;
  let fallbackTimer = null;

  function removeOverlay() {
    if (removed) return;
    removed = true;
    if (fallbackTimer !== null) view.clearTimeout(fallbackTimer);
    overlay?.remove();
  }

  function markUiReady() {
    if (leaving || removed || !appRoot?.querySelector('.app-shell')) return false;
    leaving = true;
    view.__iotStartupWatchdog?.stop?.();
    appRoot.inert = false;
    appRoot.removeAttribute('aria-hidden');
    if (!overlay) return true;

    // The page can accept input as soon as the shell exists, even while the
    // launch artwork completes its brief exit over the first painted frame.
    overlay.style.pointerEvents = 'none';
    if (view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      removeOverlay();
      return true;
    }

    const beginExit = () => {
      if (removed) return;
      overlay.addEventListener('transitionend', (event) => {
        if (event.target === overlay && event.propertyName === 'opacity') removeOverlay();
      }, { once: true });
      overlay.classList.add('startup-overlay--leaving');
      fallbackTimer = view.setTimeout(removeOverlay, 220);
    };
    firstFrame = view.requestAnimationFrame(() => {
      secondFrame = view.requestAnimationFrame(beginExit);
    });
    return true;
  }

  function dispose() {
    view.__iotStartupWatchdog?.stop?.();
    if (firstFrame !== null) view.cancelAnimationFrame(firstFrame);
    if (secondFrame !== null) view.cancelAnimationFrame(secondFrame);
    removeOverlay();
  }

  return Object.freeze({ markUiReady, dispose });
}
