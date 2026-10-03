import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeSecureSession = registerPlugin('SecureSession');

function requiredKey(key) {
  const normalized = String(key ?? '').trim();
  if (!normalized) throw new TypeError('Secure session key is required');
  return normalized;
}

function safeBrowserStorage(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  return storage;
}

/**
 * Keeps OAuth material out of Capacitor Preferences.  The browser fallback is
 * deliberately session-only; Android delegates to an Android Keystore-backed
 * native plugin registered by MainActivity.
 */
export class SecureSessionStore {
  constructor({
    nativeRuntime = Capacitor.isNativePlatform(),
    nativePlugin = NativeSecureSession,
    browserStorage = globalThis.sessionStorage
  } = {}) {
    this.nativeRuntime = nativeRuntime;
    this.nativePlugin = nativePlugin;
    this.browserStorage = safeBrowserStorage(browserStorage);
  }

  async get(key) {
    const normalized = requiredKey(key);
    if (this.nativeRuntime) {
      const result = await this.nativePlugin.get({ key: normalized });
      return typeof result?.value === 'string' ? result.value : null;
    }
    try {
      return this.browserStorage?.getItem(normalized) ?? null;
    } catch {
      return null;
    }
  }

  async set(key, value) {
    const normalized = requiredKey(key);
    const serialized = String(value ?? '');
    if (this.nativeRuntime) {
      await this.nativePlugin.set({ key: normalized, value: serialized });
      return;
    }
    if (!this.browserStorage) throw new Error('Session storage is unavailable');
    this.browserStorage.setItem(normalized, serialized);
  }

  async remove(key) {
    const normalized = requiredKey(key);
    if (this.nativeRuntime) {
      await this.nativePlugin.remove({ key: normalized });
      return;
    }
    try {
      this.browserStorage?.removeItem(normalized);
    } catch {
      // Clearing a stale session is best effort in browsers with disabled
      // storage. The in-memory OIDC session is still cleared by the caller.
    }
  }

  async getJson(key) {
    const value = await this.get(key);
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      await this.remove(key);
      return null;
    }
  }

  async setJson(key, value) {
    await this.set(key, JSON.stringify(value));
  }
}
