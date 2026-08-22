const API = '';

let accessTokenProvider = () => null;
let unauthorizedHandler = null;

function versionedPath(path) {
  const value = String(path || '');
  return value.startsWith('/api/') && !value.startsWith('/api/v1/')
    ? `/api/v1/${value.slice('/api/'.length)}`
    : value;
}

export function configureApiAuthentication({ tokenProvider = () => null, onUnauthorized = null } = {}) {
  accessTokenProvider = typeof tokenProvider === 'function' ? tokenProvider : () => null;
  unauthorizedHandler = typeof onUnauthorized === 'function' ? onUnauthorized : null;
}

export async function api(path, opts = {}, retriedAfterRefresh = false) {
  const token = await accessTokenProvider();
  const { headers: requestHeaders = {}, ...requestOptions } = opts;
  const res = await fetch(API + versionedPath(path), {
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

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
