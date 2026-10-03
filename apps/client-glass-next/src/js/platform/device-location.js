import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

const PRECISE_POSITION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 20000,
  // A foreground "use my location" action must not silently bind weather to
  // a position from a previous site. A fresh fix is preferred over a stale one.
  maximumAge: 0,
  enableLocationFallback: true
});

const APPROXIMATE_POSITION_OPTIONS = Object.freeze({
  enableHighAccuracy: false,
  timeout: 20000,
  maximumAge: 0
});

export class DeviceLocationError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'DeviceLocationError';
    this.code = code;
    this.cause = cause;
  }
}

function hasUsableLocationPermission(status = {}) {
  return status.location === 'granted' || status.coarseLocation === 'granted';
}

function hasPreciseLocationPermission(status = {}) {
  // The official Android plugin reports the `location` alias as granted only
  // when both coarse and fine permissions are available. Android 12+ may grant
  // only coarse location, which is still sufficient for a weather station.
  return status.location === 'granted';
}

function normalize(position, precision) {
  const coords = position?.coords ?? {};
  const latitude = Number(coords.latitude);
  const longitude = Number(coords.longitude);
  const accuracyM = Number(coords.accuracy);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new DeviceLocationError('UNAVAILABLE', '定位服务没有返回有效坐标。');
  }
  return Object.freeze({
    latitude,
    longitude,
    accuracyM: Number.isFinite(accuracyM) && accuracyM >= 0 ? accuracyM : null,
    capturedAt: Number.isFinite(Number(position?.timestamp)) ? Number(position.timestamp) : Date.now(),
    precision
  });
}

function browserPosition(navigatorRef, options) {
  if (!navigatorRef?.geolocation?.getCurrentPosition) {
    return Promise.reject(new DeviceLocationError('UNSUPPORTED', '当前设备不支持定位服务。'));
  }
  return new Promise((resolve, reject) => {
    navigatorRef.geolocation.getCurrentPosition(resolve, (error) => {
      const code = error?.code === 1 ? 'DENIED' : error?.code === 2 ? 'UNAVAILABLE' : 'TIMEOUT';
      reject(new DeviceLocationError(code, error?.message ?? '无法获取当前位置。', error));
    }, options);
  });
}

function classifyLocationError(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (text.includes('permission') || text.includes('denied') || text.includes('0003') || text.includes('0009')) {
    return 'DENIED';
  }
  if (text.includes('timeout') || text.includes('0010')) return 'TIMEOUT';
  if (text.includes('disabled') || text.includes('settings') || text.includes('network')
    || text.includes('unavailable') || text.includes('location') || text.includes('0007') || text.includes('0017')) {
    return 'UNAVAILABLE';
  }
  return 'UNAVAILABLE';
}

/**
 * Gets a single foreground location after an explicit user gesture. It never
 * starts a watch and therefore does not perform background tracking.
 */
export async function getCurrentDeviceLocation({
  nativeRuntime = Capacitor.isNativePlatform(),
  geolocation = Geolocation,
  navigatorRef = globalThis.navigator,
  options = null
} = {}) {
  try {
    if (nativeRuntime) {
      let permissions = await geolocation.checkPermissions();
      if (!hasUsableLocationPermission(permissions)) {
        // Ask for the normal location alias first. Android may legitimately
        // return coarse-only permission when the user selects "approximate".
        permissions = await geolocation.requestPermissions({ permissions: ['location'] });
      }
      if (!hasUsableLocationPermission(permissions)) {
        throw new DeviceLocationError('DENIED', '未获得位置权限。');
      }
      const precise = hasPreciseLocationPermission(permissions);
      const position = await geolocation.getCurrentPosition(
        options ?? (precise ? PRECISE_POSITION_OPTIONS : APPROXIMATE_POSITION_OPTIONS)
      );
      return normalize(position, precise ? 'PRECISE' : 'APPROXIMATE');
    }
    return normalize(await browserPosition(navigatorRef, options ?? PRECISE_POSITION_OPTIONS), 'PRECISE');
  } catch (error) {
    if (error instanceof DeviceLocationError) throw error;
    throw new DeviceLocationError(classifyLocationError(error), error?.message ?? '无法获取当前位置。', error);
  }
}

export function deviceLocationErrorMessage(error) {
  switch (error?.code) {
    case 'DENIED': return '未获得位置权限。请在系统设置中允许本 App 使用位置信息，然后重试。';
    case 'TIMEOUT': return '定位超时。请确认手机定位服务已开启，并移至信号更好的位置后重试。';
    case 'UNSUPPORTED': return '当前运行环境不支持定位。请改为手动填写坐标。';
    default: return '无法获取当前位置。请开启手机定位服务，或改为手动填写坐标。';
  }
}
