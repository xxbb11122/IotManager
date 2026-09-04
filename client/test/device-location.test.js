import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceLocationError, getCurrentDeviceLocation } from '../src/js/platform/device-location.js';

test('native device location requests permission once and normalizes the returned coordinates', async () => {
  const calls = [];
  const location = await getCurrentDeviceLocation({
    nativeRuntime: true,
    geolocation: {
      async checkPermissions() { calls.push('check'); return { location: 'prompt', coarseLocation: 'prompt' }; },
      async requestPermissions() { calls.push('request'); return { location: 'granted', coarseLocation: 'granted' }; },
      async getCurrentPosition(options) {
        calls.push(options);
        return { timestamp: 123, coords: { latitude: 22.5431, longitude: 114.0579, accuracy: 12.4 } };
      }
    }
  });

  assert.deepEqual(location, {
    latitude: 22.5431, longitude: 114.0579, accuracyM: 12.4, capturedAt: 123, precision: 'PRECISE'
  });
  assert.equal(calls[0], 'check');
  assert.equal(calls[1], 'request');
  assert.equal(calls[2].enableHighAccuracy, true);
  assert.equal(calls[2].maximumAge, 0);
});

test('native device location accepts Android approximate permission and deliberately downgrades accuracy mode', async () => {
  const calls = [];
  const location = await getCurrentDeviceLocation({
    nativeRuntime: true,
    geolocation: {
      async checkPermissions() { return { location: 'prompt', coarseLocation: 'prompt' }; },
      async requestPermissions(request) {
        calls.push(request);
        return { location: 'prompt', coarseLocation: 'granted' };
      },
      async getCurrentPosition(options) {
        calls.push(options);
        return { timestamp: 456, coords: { latitude: 22.54, longitude: 114.06, accuracy: 320 } };
      }
    }
  });

  assert.deepEqual(calls[0], { permissions: ['location'] });
  assert.equal(calls[1].enableHighAccuracy, false);
  assert.equal(calls[1].maximumAge, 0);
  assert.equal(location.precision, 'APPROXIMATE');
  assert.equal(location.accuracyM, 320);
});

test('native device location reports a denied permission without opening a location watch', async () => {
  await assert.rejects(
    getCurrentDeviceLocation({
      nativeRuntime: true,
      geolocation: {
        async checkPermissions() { return { location: 'denied', coarseLocation: 'denied' }; },
        async requestPermissions() { return { location: 'denied', coarseLocation: 'denied' }; },
        async getCurrentPosition() { throw new Error('must not be called'); }
      }
    }),
    (error) => error instanceof DeviceLocationError && error.code === 'DENIED'
  );
});

test('native device location classifies the Capacitor timeout code and keeps the finite request deadline', async () => {
  let receivedOptions = null;
  const timeout = Object.assign(new Error('Location request timed out'), { code: 'OS-PLUG-GLOC-0010' });

  await assert.rejects(
    getCurrentDeviceLocation({
      nativeRuntime: true,
      geolocation: {
        async checkPermissions() { return { location: 'granted', coarseLocation: 'granted' }; },
        async requestPermissions() { throw new Error('must not be called'); },
        async getCurrentPosition(options) {
          receivedOptions = options;
          throw timeout;
        }
      }
    }),
    (error) => error instanceof DeviceLocationError && error.code === 'TIMEOUT' && error.cause === timeout
  );

  assert.equal(receivedOptions.timeout, 20_000);
  assert.equal(receivedOptions.enableHighAccuracy, true);
  assert.equal(receivedOptions.maximumAge, 0);
});

test('browser geolocation maps callback timeout failures without starting a location watch', async () => {
  let receivedOptions = null;
  let watchCalled = false;

  await assert.rejects(
    getCurrentDeviceLocation({
      nativeRuntime: false,
      navigatorRef: {
        geolocation: {
          getCurrentPosition(_resolve, reject, options) {
            receivedOptions = options;
            reject({ code: 3, message: 'Position acquisition timed out' });
          },
          watchPosition() { watchCalled = true; }
        }
      }
    }),
    (error) => error instanceof DeviceLocationError && error.code === 'TIMEOUT'
  );

  assert.equal(receivedOptions.timeout, 20_000);
  assert.equal(receivedOptions.maximumAge, 0);
  assert.equal(watchCalled, false);
});
