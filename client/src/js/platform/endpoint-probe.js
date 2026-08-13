import { ApiClient } from '../api.js';
import { normalizeEndpointProfile } from './runtime-config.js';

/**
 * Maps endpoint configuration failures to operator-facing Chinese messages so
 * the connection settings screen never leaks raw TypeError text.
 */
export function friendlyEndpointError(error) {
  if (error?.name === 'TypeError') {
    const message = String(error.message);
    if (message.includes('accessRoute')) return '请先选择现场 LAN 或互联网远程。';
    if (message.includes('API URL')) return 'API 地址必须使用 http:// 或 https://。';
    if (message.includes('WebSocket URL')) return 'WebSocket 地址必须使用 ws:// 或 wss://。';
  }
  if (error?.message === 'Failed to fetch') return '无法连接到该地址，请检查网络、地址或服务器状态。';
  return error?.message || '连接测试失败，请稍后重试。';
}

/**
 * Validates and probes an endpoint profile without persisting it. A successful
 * REST response is the first gate before an operator switches the app to an
 * on-site or internet-remote platform.
 */
export async function probeEndpoint({
  accessRoute,
  apiBaseUrl,
  wsUrl,
  organizationCode,
  fetchImpl,
  timeoutMs = 8000,
  verifyWebSocket = false,
  webSocketFactory = globalThis.WebSocket
} = {}) {
  let profile;
  try {
    profile = normalizeEndpointProfile({
      id: accessRoute === 'CLOUD_API' ? 'cloud-probe' : 'site-probe',
      accessRoute,
      apiBaseUrl,
      wsUrl,
      organizationCode
    });
  } catch (error) {
    return { ok: false, message: friendlyEndpointError(error) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const api = new ApiClient({ baseUrl: profile.apiBaseUrl, fetchImpl });
    const devices = await api.listDevices({}, { signal: controller.signal });
    if (verifyWebSocket) {
      await probeWebSocket(profile.wsUrl, webSocketFactory, timeoutMs);
    }
    return {
      ok: true,
      message: Array.isArray(devices) && devices.length > 0
        ? `连接成功：API 与实时连接正常，已获取 ${devices.length} 台设备。`
        : '连接成功：API 与实时连接正常，当前没有设备。'
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, message: '连接超时，请确认地址可访问。' };
    }
    return { ok: false, message: friendlyEndpointError(error) };
  } finally {
    clearTimeout(timer);
  }
}

function probeWebSocket(url, factory, timeoutMs) {
  if (typeof factory !== 'function') {
    return Promise.reject(new Error('当前环境不支持实时连接测试。'));
  }
  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close?.(1000, 'endpoint probe complete'); } catch { /* no-op */ }
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('实时连接超时，请检查 WebSocket 地址和后端状态。')), timeoutMs);
    try {
      socket = new factory(url);
      socket.onopen = () => finish(resolve);
      socket.onerror = () => finish(reject, new Error('实时连接失败，请检查 WebSocket 地址和后端状态。'));
      socket.onclose = () => {
        if (!settled) finish(reject, new Error('实时连接被服务器关闭，请检查 WebSocket 地址和后端状态。'));
      };
    } catch (error) {
      finish(reject, error instanceof Error ? error : new Error(String(error)));
    }
  });
}
