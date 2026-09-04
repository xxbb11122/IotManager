import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const baseUrl = String(process.env.IOT_RUNTIME_BASE_URL ?? '').replace(/\/$/, '');
const username = process.env.IOT_E2E_OWNER_USERNAME;
const password = process.env.IOT_E2E_OWNER_PASSWORD;
const deviceCount = Number.parseInt(process.env.IOT_LOAD_SIMULATION_DEVICES ?? '0', 10);
const websocketCount = Number.parseInt(process.env.IOT_LOAD_SIMULATION_WEBSOCKETS ?? '0', 10);
const requestConcurrency = Number.parseInt(process.env.IOT_LOAD_SIMULATION_CONCURRENCY ?? '25', 10);
const evidenceFile = resolve(process.env.IOT_LOAD_SIMULATION_EVIDENCE ?? 'test-results/runtime-load.json');

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1)];
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function login(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-action').click();
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click({ noWaitAfter: true });
  const currentToken = async () => {
    try {
      return await page.evaluate(() => {
      return JSON.parse(sessionStorage.getItem('iot-manager.browser-oidc-session.v1') || 'null')?.accessToken ?? null;
      });
    } catch {
      // Keycloak redirects across origins before returning to the dashboard.
      // A navigation may destroy this execution context; polling is the
      // synchronization boundary rather than treating that transient as a
      // failed login.
      return null;
    }
  };
  await expect.poll(currentToken, { timeout: 30_000 }).toBeTruthy();
  return currentToken();
}

async function apiRequest(page, token, path, { method = 'GET', body } = {}) {
  return page.evaluate(async ({ accessToken, requestPath, requestMethod, requestBody }) => {
    const response = await fetch(requestPath, {
      method: requestMethod,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(requestBody === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) })
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    return { status: response.status, payload };
  }, { accessToken: token, requestPath: path, requestMethod: method, requestBody: body });
}

async function openWebSockets(page, count, token) {
  return page.evaluate(async ({ targetCount, accessToken }) => {
    const endpoint = `${location.origin.replace(/^http/, 'ws')}/ws/devices?siteCode=primary-site`;
    const state = {
      sockets: [],
      messageCounts: Array.from({ length: targetCount }, () => 0),
      errors: 0
    };
    globalThis.__iotLoadSimulation = state;
    const openings = Array.from({ length: targetCount }, (_, index) => new Promise((resolveOpening) => {
      const socket = new WebSocket(endpoint, ['iot-v1', `iot-bearer.${accessToken}`]);
      state.sockets.push(socket);
      const timeout = setTimeout(() => resolveOpening({ index, opened: false, reason: 'timeout' }), 20_000);
      socket.onopen = () => {
        clearTimeout(timeout);
        resolveOpening({ index, opened: true });
      };
      socket.onmessage = () => { state.messageCounts[index] += 1; };
      socket.onerror = () => {
        state.errors += 1;
        clearTimeout(timeout);
        resolveOpening({ index, opened: false, reason: 'error' });
      };
    }));
    return Promise.all(openings);
  }, { targetCount: count, accessToken: token });
}

async function readWebSocketStats(page) {
  return page.evaluate(() => {
    const state = globalThis.__iotLoadSimulation;
    if (!state) {
      return { opened: 0, messages: 0, minimumMessages: 0, maximumMessages: 0, errors: 0 };
    }
    const messageCounts = [...state.messageCounts];
    return {
      opened: state.sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length,
      messages: messageCounts.reduce((total, value) => total + value, 0),
      minimumMessages: messageCounts.length === 0 ? 0 : Math.min(...messageCounts),
      maximumMessages: messageCounts.length === 0 ? 0 : Math.max(...messageCounts),
      errors: state.errors
    };
  });
}

async function closeWebSockets(page) {
  const stats = await readWebSocketStats(page);
  await page.evaluate(async () => {
    const state = globalThis.__iotLoadSimulation;
    if (!state) return;
    for (const socket of state.sockets) socket.close(1000, 'simulation complete');
    await new Promise((resolveClose) => setTimeout(resolveClose, 250));
  });
  return stats;
}

test.describe('explicit 1000-device runtime simulation', () => {
  test.skip(!baseUrl || deviceCount <= 0 || websocketCount <= 0,
    'Set IOT_RUNTIME_BASE_URL, IOT_LOAD_SIMULATION_DEVICES, and IOT_LOAD_SIMULATION_WEBSOCKETS.');

  test('creates isolated devices while 100 authenticated WebSockets receive events', async ({ browser }) => {
    test.setTimeout(15 * 60_000);
    expect(username, 'IOT_E2E_OWNER_USERNAME must be set').toBeTruthy();
    expect(password, 'IOT_E2E_OWNER_PASSWORD must be set').toBeTruthy();
    expect(deviceCount).toBeGreaterThan(0);
    expect(deviceCount).toBeLessThanOrEqual(2_000);
    expect(websocketCount).toBeGreaterThan(0);
    expect(websocketCount).toBeLessThanOrEqual(250);
    expect(requestConcurrency).toBeGreaterThan(0);
    expect(requestConcurrency).toBeLessThanOrEqual(100);

    const context = await browser.newContext({
      ignoreHTTPSErrors: process.env.IOT_RUNTIME_IGNORE_BROWSER_HTTPS_ERRORS === 'true'
    });
    const page = await context.newPage();
    const createdIds = [];
    const prefix = `sim-${Date.now()}`;
    let socketStats = {
      opened: 0,
      messages: 0,
      minimumMessages: 0,
      maximumMessages: 0,
      errors: 0
    };
    const startedAt = new Date().toISOString();
    const evidence = {
      startedAt,
      completedAt: null,
      target: { deviceCount, websocketCount, requestConcurrency },
      result: null,
      cleanup: null
    };
    try {
      const token = await login(page);
      const websocketOpenings = await openWebSockets(page, websocketCount, token);
      expect(websocketOpenings.filter((result) => result.opened).length).toBe(websocketCount);

      const indexes = Array.from({ length: deviceCount }, (_, index) => index);
      const createStarted = Date.now();
      const createResults = await runPool(indexes, requestConcurrency, async (index) => {
        const requestStarted = Date.now();
        const response = await apiRequest(page, token, '/api/v1/devices?siteCode=primary-site', {
          method: 'POST',
          body: {
            name: `${prefix}-${String(index).padStart(4, '0')}`,
            type: 'SENSOR',
            protocol: 'SIMULATION',
            location: 'isolated-load-test',
            firmwareVersion: 'simulation-1.0.0',
            status: 'ONLINE'
          }
        });
        const { status, payload } = response;
        if (status === 200 && payload?.id != null) createdIds.push(payload.id);
        return { status, latencyMs: Date.now() - requestStarted };
      });
      const createDurationMs = Date.now() - createStarted;
      const failedCreates = createResults.filter((result) => result.status !== 200);

      await expect.poll(async () => (await readWebSocketStats(page)).minimumMessages, {
        message: 'Every authenticated WebSocket must receive every simulated device event',
        timeout: 90_000,
        intervals: [250, 500, 1_000, 2_000]
      }).toBeGreaterThanOrEqual(deviceCount);
      socketStats = await readWebSocketStats(page);

      const listStarted = Date.now();
      const listResponse = await apiRequest(page, token, '/api/v1/devices?siteCode=primary-site');
      const listStatus = listResponse.status;
      const listedDevices = listStatus === 200 ? listResponse.payload : [];
      const listDurationMs = Date.now() - listStarted;
      const matchingDevices = listedDevices.filter((device) => String(device.name ?? '').startsWith(prefix)).length;

      const latencies = createResults.map((result) => result.latencyMs);
      evidence.result = {
        created: createdIds.length,
        failedCreates: failedCreates.length,
        createDurationMs,
        createThroughputPerSecond: Number((createdIds.length / (createDurationMs / 1_000)).toFixed(2)),
        createLatencyMs: {
          p50: percentile(latencies, 50),
          p95: percentile(latencies, 95),
          p99: percentile(latencies, 99),
          max: Math.max(...latencies)
        },
        websocket: socketStats,
        list: { status: listStatus, durationMs: listDurationMs, matchingDevices }
      };

      expect(failedCreates).toEqual([]);
      expect(createdIds).toHaveLength(deviceCount);
      expect(socketStats.opened).toBe(websocketCount);
      expect(socketStats.errors).toBe(0);
      expect(socketStats.minimumMessages).toBeGreaterThanOrEqual(deviceCount);
      expect(listStatus).toBe(200);
      expect(matchingDevices).toBe(deviceCount);
    } finally {
      try { socketStats = await closeWebSockets(page); } catch { /* cleanup continues */ }
      let cleanupResults = [];
      let cleanupListStatus = null;
      let remainingActive = null;
      if (createdIds.length > 0) {
        const token = await page.evaluate(() => JSON.parse(
          sessionStorage.getItem('iot-manager.browser-oidc-session.v1') || 'null'
        )?.accessToken ?? null).catch(() => null);
        if (token) {
          cleanupResults = await runPool(createdIds, Math.min(50, requestConcurrency * 2), async (id) => {
            const response = await apiRequest(page, token, `/api/v1/devices/${id}`, { method: 'DELETE' });
            return response.status;
          });
          const cleanupList = await apiRequest(page, token, '/api/v1/devices?siteCode=primary-site');
          cleanupListStatus = cleanupList.status;
          remainingActive = cleanupList.status === 200
            ? cleanupList.payload.filter((device) => String(device.name ?? '').startsWith(prefix)).length
            : null;
        }
      }
      evidence.completedAt = new Date().toISOString();
      evidence.cleanup = {
        attempted: createdIds.length,
        archived: cleanupResults.filter((status) => status === 204).length,
        failed: cleanupResults.filter((status) => status !== 204).length,
        listStatus: cleanupListStatus,
        remainingActive,
        websocketBeforeClose: socketStats
      };
      mkdirSync(dirname(evidenceFile), { recursive: true });
      writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      await context.close();
      if (createdIds.length > 0) {
        expect(evidence.cleanup.archived).toBe(createdIds.length);
        expect(evidence.cleanup.failed).toBe(0);
        expect(evidence.cleanup.listStatus).toBe(200);
        expect(evidence.cleanup.remainingActive).toBe(0);
      }
    }
  });
});
