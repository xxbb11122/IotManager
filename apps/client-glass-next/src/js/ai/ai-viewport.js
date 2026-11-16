// Some WebViews resize only the visual viewport when the keyboard overlays the
// layout viewport. Restrict this fallback to the focused chat field; pinch zoom
// keeps the browser's normal viewport behavior.
export function createAiViewport(root) {
  const windowObject = root.ownerDocument.defaultView;
  const viewport = windowObject.visualViewport;
  let frame = null, disposed = false;
  function update() {
    if (disposed) return;
    const focused = root.dataset.activeScreen === 'ai'
      && root.ownerDocument.activeElement?.id === 'ai-question';
    const overlay = focused && viewport && Math.abs(viewport.scale - 1) < .01
      && viewport.height > 0 && viewport.height < windowObject.innerHeight - 1;
    if (overlay) {
      root.style.setProperty('--ai-viewport-height', Math.floor(viewport.height) + 'px');
      root.dataset.aiKeyboardOverlay = 'true';
    } else {
      root.style.removeProperty('--ai-viewport-height');
      delete root.dataset.aiKeyboardOverlay;
    }
  }
  function schedule() {
    if (!disposed && frame === null) frame = windowObject.requestAnimationFrame(() => { frame = null; update(); });
  }
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  root.addEventListener('focusin', schedule);
  root.addEventListener('focusout', schedule);
  windowObject.addEventListener('resize', schedule);
  return {
    update,
    destroy() {
      disposed = true;
      if (frame !== null) windowObject.cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      root.removeEventListener('focusin', schedule);
      root.removeEventListener('focusout', schedule);
      windowObject.removeEventListener('resize', schedule);
      root.style.removeProperty('--ai-viewport-height');
      delete root.dataset.aiKeyboardOverlay;
    }
  };
}
