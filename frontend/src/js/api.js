const API_BASE = '';
let accessTokenProvider = accessToken;
let unauthorizedHandler = null;

function accessToken() {
  const runtimeToken = globalThis.__IOT_ACCESS_TOKEN__;
  const buildToken = import.meta.env?.VITE_ACCESS_TOKEN;
  return String(runtimeToken ?? buildToken ?? '').trim();
}

function versionedPath(path) {
  const value = String(path || '');
  return value.startsWith('/api/') && !value.startsWith('/api/v1/')
    ? `/api/v1/${value.slice('/api/'.length)}`
    : value;
}

export function configureApiAuthentication({ tokenProvider = accessToken, onUnauthorized = null } = {}) {
  accessTokenProvider = typeof tokenProvider === 'function' ? tokenProvider : accessToken;
  unauthorizedHandler = typeof onUnauthorized === 'function' ? onUnauthorized : null;
}

export async function api(path, opts = {}, retriedAfterRefresh = false) {
  const token = await accessTokenProvider();
  const { headers: requestHeaders = {}, ...requestOptions } = opts;
  const res = await fetch(API_BASE + versionedPath(path), {
    ...requestOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...requestHeaders
    }
  });
  if (res.status === 401 && !retriedAfterRefresh && unauthorizedHandler && await unauthorizedHandler()) {
    return api(path, opts, true);
  }
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg || res.statusText);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}
