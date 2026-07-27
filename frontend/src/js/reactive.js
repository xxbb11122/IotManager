/**
 * 超轻量响应式工具（无框架依赖）
 * 类似 Vue 的 ref，触发 DOM 更新
 */

let currentMountedCallback = null;

export function ref(initialValue) {
  let val = initialValue;
  const watchers = [];

  return {
    get value() { return val; },
    set value(v) {
      if (val !== v) {
        val = v;
        watchers.forEach(fn => fn(v));
      }
    }
  };
}

export function onMounted(fn) {
  document.addEventListener('DOMContentLoaded', fn);
  // If DOMContentLoaded already fired
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(fn, 1);
  }
}

export function onUnmounted(fn) {
  window.addEventListener('beforeunload', fn);
}
