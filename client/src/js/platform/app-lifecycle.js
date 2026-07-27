import { App } from '@capacitor/app';

export async function attachAppLifecycle({ appPlugin = App, onBackground, onForeground } = {}) {
  if (typeof onBackground !== 'function' || typeof onForeground !== 'function') {
    throw new TypeError('App lifecycle requires background and foreground handlers');
  }
  let transition = Promise.resolve();
  return appPlugin.addListener('appStateChange', ({ isActive }) => {
    transition = transition.then(() => isActive ? onForeground() : onBackground());
    return transition;
  });
}
