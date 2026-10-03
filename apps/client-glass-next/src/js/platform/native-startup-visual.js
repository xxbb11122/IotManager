import { Capacitor, registerPlugin } from '@capacitor/core';

const StartupVisual = registerPlugin('StartupVisual');

export function createNativeStartupVisual({
  nativeRuntime = Capacitor.getPlatform() === 'android',
  plugin = StartupVisual
} = {}) {
  if (!nativeRuntime) return null;
  return Object.freeze({
    addExitListener: (callback) => plugin.addListener('exitComplete', callback),
    getLaunchState: () => plugin.getLaunchState(),
    prepareReveal: (options) => plugin.prepareReveal(options)
  });
}
