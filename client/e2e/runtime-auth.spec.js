import { expect, test } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import tls from 'node:tls';

const baseUrl = String(process.env.IOT_RUNTIME_BASE_URL ?? '').replace(/\/$/, '');
const ownerUsername = process.env.IOT_E2E_OWNER_USERNAME;
const ownerPassword = process.env.IOT_E2E_OWNER_PASSWORD;
const adminUsername = process.env.IOT_E2E_ADMIN_USERNAME;
const adminPassword = process.env.IOT_E2E_ADMIN_PASSWORD;
const operatorUsername = process.env.IOT_E2E_OPERATOR_USERNAME;
const operatorPassword = process.env.IOT_E2E_OPERATOR_PASSWORD;
const viewerUsername = process.env.IOT_E2E_VIEWER_USERNAME;
const viewerPassword = process.env.IOT_E2E_VIEWER_PASSWORD;

async function newRuntimeContext(browser) {
  // Docker's local Caddy certificate is intentionally private to the test
  // stack. Importing it into the Windows certificate store is not reliable in
  // headless CI/Desktop sessions (and can block indefinitely). A local runner
  // may explicitly opt into this narrow test-only bypass; CI installs the CA
  // and continues to verify the browser trust chain normally. The edge test
  // below always performs an explicit CA-verified TLS handshake.
  return browser.newContext({
    ignoreHTTPSErrors: process.env.IOT_RUNTIME_IGNORE_BROWSER_HTTPS_ERRORS === 'true'
  });
}

function edgeHandshake(endpoint, credentialId, credentialToken) {
  const url = new URL(endpoint);
  const caPath = process.env.IOT_RUNTIME_CA_CERTIFICATE;
  const ca = caPath ? readFileSync(caPath) : undefined;
  // Browsers special-case *.localhost as loopback, while Node's DNS resolver
  // on Windows can leave it pending or fail it entirely. Keep the public
  // Host/SNI value for Caddy certificate validation, but make the local
  // integration transport deterministic across CI and Docker Desktop hosts.
  const connectionHost = url.hostname.endsWith('.localhost') ? '127.0.0.1' : url.hostname;
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: connectionHost,
      port: Number(url.port || 443),
      servername: url.hostname,
      ca,
      rejectUnauthorized: true
    });
    let settled = false;
    let response = Buffer.alloc(0);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    socket.setTimeout(10_000, () => {
      socket.destroy();
      finish(reject, new Error('Timed out waiting for the edge WebSocket handshake.'));
    });
    socket.on('error', () => finish(reject, new Error('Edge WebSocket TLS handshake failed.')));
    socket.on('close', () => {
      if (!settled) finish(reject, new Error('Edge WebSocket closed before returning an HTTP response.'));
    });
    socket.on('secureConnect', () => {
      const key = randomBytes(16).toString('base64');
      socket.write([
        `GET ${url.pathname} HTTP/1.1`,
        `Host: ${url.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        `X-Iot-Agent-Credential: ${credentialId}`,
        `X-Iot-Agent-Token: ${credentialToken}`,
        '',
        ''
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      response = Buffer.concat([response, Buffer.from(chunk)]);
      const end = response.indexOf('\r\n\r\n');
      if (end < 0) return;
      const header = response.subarray(0, end).toString('utf8');
      const status = Number(/^HTTP\/1\.1\s+(\d{3})/i.exec(header)?.[1] ?? 0);
      if (status !== 101) socket.end();
      finish(resolve, { status, socket });
    });
  });
}

function sendMaskedText(socket, message) {
  const payload = Buffer.from(message, 'utf8');
  if (payload.length > 65_535) throw new Error('P0 edge hello exceeds the supported test frame length.');
  const mask = randomBytes(4);
  const header = payload.length <= 125
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % mask.length];
  }
  socket.write(Buffer.concat([header, mask, masked]));
}

async function ownerToken(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('iot-manager.browser-oidc-session.v1');
    return raw ? JSON.parse(raw).accessToken : null;
  });
}

async function currentBrowserToken(page) {
  try {
    return await ownerToken(page);
  } catch {
    // The page is briefly cross-origin while Keycloak redirects back. Retry
    // rather than treating that navigation window as a login failure.
    return null;
  }
}

async function completeBrowserLogin(page, username, password) {
  await page.locator('#auth-action').click();
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);

  // The dashboard strips code/state from the callback URL immediately after a
  // successful exchange. Waiting on a transient URL is therefore less stable
  // than asserting the persistent boundary the app owns: its in-memory/session
  // PKCE result. noWaitAfter prevents the click itself from racing that return
  // navigation; the poll below is the definitive completion signal.
  await page.locator('#kc-login').click({ noWaitAfter: true });
  await expect.poll(() => currentBrowserToken(page), { timeout: 30_000 }).toBeTruthy();
  return ownerToken(page);
}

async function login(browser, username, password) {
  expect(username, 'Keycloak integration username must be set').toBeTruthy();
  expect(password, 'Keycloak integration password must be set').toBeTruthy();
  const context = await newRuntimeContext(browser);
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const token = await completeBrowserLogin(page, username, password);
  expect(token, 'Browser PKCE login must yield an access token').toBeTruthy();
  return { context, page, token };
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

async function requestOidcToken(page, values) {
  return page.evaluate(async (tokenValues) => {
    const discovery = await fetch(`${location.origin}/auth/realms/iot-manager/.well-known/openid-configuration`)
      .then((response) => response.json());
    const response = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(tokenValues).toString()
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* assertions use the status */ }
    return { status: response.status, payload };
  }, values);
}

async function browserRefreshToken(page) {
  return page.evaluate(() => JSON.parse(
    sessionStorage.getItem('iot-manager.browser-oidc-session.v1') || 'null'
  )?.refreshToken ?? null);
}

function deviceRequestBody(prefix) {
  return {
    name: `${prefix}-${Date.now()}`,
    type: 'SENSOR',
    protocol: 'HTTP',
    location: 'runtime-rbac',
    firmwareVersion: '1.0.0',
    status: 'ONLINE'
  };
}

test.describe('P0 Keycloak, API, and WSS runtime boundary', () => {
  test.skip(!baseUrl, 'Runtime end-to-end tests only run against the integration Caddy endpoint.');

  test('OWNER completes PKCE and can use the protected API and WebSocket', async ({ browser }) => {
    expect(ownerUsername, 'IOT_E2E_OWNER_USERNAME must be set').toBeTruthy();
    expect(ownerPassword, 'IOT_E2E_OWNER_PASSWORD must be set').toBeTruthy();
    const context = await newRuntimeContext(browser);
    const page = await context.newPage();

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await completeBrowserLogin(page, ownerUsername, ownerPassword);
    await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
    expect(page.url()).not.toContain('access_token=');

    const api = await page.evaluate(async () => {
      const raw = sessionStorage.getItem('iot-manager.browser-oidc-session.v1');
      if (!raw) return { status: 0, reason: 'missing browser OIDC session' };
      const token = JSON.parse(raw).accessToken;
      const response = await fetch('/api/v1/me', { headers: { Authorization: `Bearer ${token}` } });
      return { status: response.status, body: await response.text() };
    });
    expect(api.status, api.body).toBe(200);

    const websocket = await page.evaluate(async () => {
      const raw = sessionStorage.getItem('iot-manager.browser-oidc-session.v1');
      const token = JSON.parse(raw).accessToken;
      const endpoint = `${location.origin.replace(/^http/, 'ws')}/ws/devices?siteCode=primary-site`;
      return new Promise((resolve) => {
        const socket = new WebSocket(endpoint, ['iot-v1', `iot-bearer.${token}`]);
        const timeout = setTimeout(() => {
          socket.close();
          resolve({ opened: false, detail: 'timed out' });
        }, 10_000);
        socket.onopen = () => socket.send('ping');
        socket.onmessage = (event) => {
          clearTimeout(timeout);
          socket.close();
          resolve({ opened: true, detail: event.data });
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          resolve({ opened: false, detail: 'websocket error' });
        };
      });
    });
    expect(websocket.opened, websocket.detail).toBe(true);
    expect(websocket.detail).toBe('pong');
    await context.close();
  });

  test('VIEWER can read but cannot write through the protected API', async ({ browser }) => {
    expect(viewerUsername, 'IOT_E2E_VIEWER_USERNAME must be set').toBeTruthy();
    expect(viewerPassword, 'IOT_E2E_VIEWER_PASSWORD must be set').toBeTruthy();
    const context = await newRuntimeContext(browser);
    const page = await context.newPage();

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await completeBrowserLogin(page, viewerUsername, viewerPassword);

    const statuses = await page.evaluate(async () => {
      const raw = sessionStorage.getItem('iot-manager.browser-oidc-session.v1');
      const token = JSON.parse(raw).accessToken;
      const headers = { Authorization: `Bearer ${token}` };
      const [read, write] = await Promise.all([
        fetch('/api/v1/sites', { headers }),
        fetch('/api/v1/devices', { method: 'POST', headers })
      ]);
      return { read: read.status, write: write.status };
    });
    expect(statuses.read).toBe(200);
    expect(statuses.write).toBe(403);
    await context.close();
  });

  test('four real Keycloak roles enforce write, delete, agent, and two-site boundaries', async ({ browser }) => {
    test.setTimeout(90_000);
    const owner = await login(browser, ownerUsername, ownerPassword);
    const admin = await login(browser, adminUsername, adminPassword);
    const operator = await login(browser, operatorUsername, operatorPassword);
    const viewer = await login(browser, viewerUsername, viewerPassword);
    try {
      const allUsers = [owner, admin, operator, viewer];
      const siteViews = await Promise.all(allUsers.map((session) => apiRequest(session.page, session.token, '/api/v1/sites')));
      for (const response of siteViews) expect(response.status).toBe(200);
      expect(siteViews[0].payload.map((site) => site.siteCode)).toEqual(expect.arrayContaining(['primary-site', 'restricted-site']));
      for (const response of siteViews.slice(1)) {
        expect(response.payload.map((site) => site.siteCode)).toContain('primary-site');
        expect(response.payload.map((site) => site.siteCode)).not.toContain('restricted-site');
      }

      const restrictedDevice = await apiRequest(owner.page, owner.token, '/api/v1/devices?siteCode=restricted-site', {
        method: 'POST', body: deviceRequestBody('restricted-owner-device')
      });
      expect(restrictedDevice.status).toBe(200);
      expect(restrictedDevice.payload?.id).toBeTruthy();
      const crossSiteRead = await apiRequest(admin.page, admin.token, `/api/v1/devices/${restrictedDevice.payload.id}`);
      expect(crossSiteRead.status).toBe(403);
      const crossSiteWeather = await apiRequest(operator.page, operator.token, '/api/v1/sites/restricted-site/weather');
      expect(crossSiteWeather.status).toBe(403);

      const ownerDeleteTarget = await apiRequest(owner.page, owner.token, '/api/v1/devices?siteCode=primary-site', {
        method: 'POST', body: deviceRequestBody('owner-delete-target')
      });
      expect(ownerDeleteTarget.status).toBe(200);
      const adminWrite = await apiRequest(admin.page, admin.token, '/api/v1/devices?siteCode=primary-site', {
        method: 'POST', body: deviceRequestBody('admin-write')
      });
      expect(adminWrite.status).toBe(200);
      const adminDelete = await apiRequest(admin.page, admin.token, `/api/v1/devices/${ownerDeleteTarget.payload.id}`, { method: 'DELETE' });
      expect(adminDelete.status).toBe(204);

      const operatorWrite = await apiRequest(operator.page, operator.token, '/api/v1/devices?siteCode=primary-site', {
        method: 'POST', body: deviceRequestBody('operator-write')
      });
      expect(operatorWrite.status).toBe(200);
      const operatorDelete = await apiRequest(operator.page, operator.token, `/api/v1/devices/${operatorWrite.payload.id}`, { method: 'DELETE' });
      expect(operatorDelete.status).toBe(403);
      const viewerWrite = await apiRequest(viewer.page, viewer.token, '/api/v1/devices?siteCode=primary-site', {
        method: 'POST', body: deviceRequestBody('viewer-write')
      });
      expect(viewerWrite.status).toBe(403);
      const viewerDelete = await apiRequest(viewer.page, viewer.token, `/api/v1/devices/${operatorWrite.payload.id}`, { method: 'DELETE' });
      expect(viewerDelete.status).toBe(403);

      const credentialPayload = (agentId) => ({ agentId, siteCode: 'primary-site', agentName: 'RBAC test agent', reason: 'runtime role matrix' });
      const [ownerCredential, adminCredential, operatorCredential, viewerCredential] = await Promise.all([
        apiRequest(owner.page, owner.token, '/api/v1/edge-agents/credentials', { method: 'POST', body: credentialPayload(`owner-rbac-${Date.now()}`) }),
        apiRequest(admin.page, admin.token, '/api/v1/edge-agents/credentials', { method: 'POST', body: credentialPayload(`admin-rbac-${Date.now()}`) }),
        apiRequest(operator.page, operator.token, '/api/v1/edge-agents/credentials', { method: 'POST', body: credentialPayload(`operator-rbac-${Date.now()}`) }),
        apiRequest(viewer.page, viewer.token, '/api/v1/edge-agents/credentials', { method: 'POST', body: credentialPayload(`viewer-rbac-${Date.now()}`) })
      ]);
      expect(ownerCredential.status).toBe(201);
      expect(adminCredential.status).toBe(201);
      expect(operatorCredential.status).toBe(403);
      expect(viewerCredential.status).toBe(403);
    } finally {
      await Promise.all([owner.context.close(), admin.context.close(), operator.context.close(), viewer.context.close()]);
    }
  });

  test('PKCE authorization codes and rotated refresh tokens cannot be replayed after logout', async ({ browser }) => {
    test.setTimeout(90_000);
    expect(ownerUsername, 'IOT_E2E_OWNER_USERNAME must be set').toBeTruthy();
    expect(ownerPassword, 'IOT_E2E_OWNER_PASSWORD must be set').toBeTruthy();

    // Keycloak deliberately invalidates a complete user session after a code
    // or refresh-token replay. Exercise each replay boundary in its own real
    // browser session so one expected security rejection cannot erase the
    // evidence for the next boundary.
    const codeContext = await newRuntimeContext(browser);
    const codePage = await codeContext.newPage();
    let authorizationCode = null;
    codePage.on('request', (request) => {
      if (!request.url().includes('/protocol/openid-connect/token')) return;
      const form = new URLSearchParams(request.postData() ?? '');
      if (form.get('grant_type') === 'authorization_code') authorizationCode = form.get('code');
    });
    await codePage.addInitScript(() => {
      const transactionKey = 'iot-manager.browser-oidc-transaction.v1';
      const captureKey = 'iot-manager.browser-oidc-e2e-transaction.v1';
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function patchedSetItem(key, value) {
        if (key === transactionKey) originalSetItem.call(this, captureKey, value);
        return originalSetItem.call(this, key, value);
      };
    });
    try {
      await codePage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await completeBrowserLogin(codePage, ownerUsername, ownerPassword);
      expect(authorizationCode, 'The live PKCE exchange must contain an authorization code').toBeTruthy();
      const transaction = await codePage.evaluate(() => JSON.parse(
        sessionStorage.getItem('iot-manager.browser-oidc-e2e-transaction.v1') || 'null'
      ));
      expect(transaction?.redirectUri, 'The live PKCE transaction must retain its redirect URI').toBeTruthy();
      expect(transaction?.verifier, 'The live PKCE transaction must retain its verifier').toBeTruthy();
      const codeReplay = await requestOidcToken(codePage, {
        grant_type: 'authorization_code', code: authorizationCode, client_id: 'iot-web',
        redirect_uri: transaction.redirectUri, code_verifier: transaction.verifier
      });
      expect(codeReplay.status).toBe(400);
    } finally {
      await codeContext.close();
    }

    const refreshSession = await login(browser, ownerUsername, ownerPassword);
    try {
      const initialRefreshToken = await browserRefreshToken(refreshSession.page);
      expect(initialRefreshToken, 'A PKCE session must include a refresh token').toBeTruthy();
      const firstRefresh = await requestOidcToken(refreshSession.page, {
        grant_type: 'refresh_token', refresh_token: initialRefreshToken, client_id: 'iot-web'
      });
      expect(firstRefresh.status).toBe(200);
      expect(firstRefresh.payload?.refresh_token).toBeTruthy();
      const refreshReplay = await requestOidcToken(refreshSession.page, {
        grant_type: 'refresh_token', refresh_token: initialRefreshToken, client_id: 'iot-web'
      });
      expect(refreshReplay.status).toBe(400);
    } finally {
      await refreshSession.context.close();
    }

    const logoutSession = await login(browser, ownerUsername, ownerPassword);
    try {
      const refreshToken = await browserRefreshToken(logoutSession.page);
      expect(refreshToken, 'A fresh session must include a refresh token').toBeTruthy();
      await logoutSession.page.locator('#auth-action').click({ noWaitAfter: true });
      await logoutSession.page.locator('#auth-action').waitFor({ state: 'visible', timeout: 30_000 });
      await expect.poll(() => logoutSession.page.evaluate(
        () => sessionStorage.getItem('iot-manager.browser-oidc-session.v1')
      ), { timeout: 30_000 }).toBeNull();
      const postLogout = await requestOidcToken(logoutSession.page, {
        grant_type: 'refresh_token', refresh_token: refreshToken, client_id: 'iot-web'
      });
      expect(postLogout.status).toBe(400);
    } finally {
      await logoutSession.context.close();
    }
  });

  test('OWNER-issued edge credentials rotate and revoke across Caddy WSS', async ({ browser }) => {
    expect(ownerUsername, 'IOT_E2E_OWNER_USERNAME must be set').toBeTruthy();
    expect(ownerPassword, 'IOT_E2E_OWNER_PASSWORD must be set').toBeTruthy();
    const context = await newRuntimeContext(browser);
    const page = await context.newPage();
    const agentId = `p0-runtime-agent-${Date.now()}`;

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const token = await completeBrowserLogin(page, ownerUsername, ownerPassword);
    expect(token, 'OWNER PKCE session must yield an access token').toBeTruthy();

    const credential = await page.evaluate(async ({ accessToken, requestedAgentId }) => {
      const response = await fetch('/api/v1/edge-agents/credentials', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId: requestedAgentId,
          siteCode: 'primary-site',
          agentName: 'P0 runtime edge agent',
          reason: 'P0 Docker runtime test'
        })
      });
      return { status: response.status, body: await response.json() };
    }, { accessToken: token, requestedAgentId: agentId });
    expect(credential.status).toBe(201);
    expect(credential.body.credentialId).toBeTruthy();
    expect(credential.body.token).toBeTruthy();

    const accepted = await edgeHandshake(
      `${baseUrl.replace(/^http/, 'ws')}/ws/edge/v1`,
      credential.body.credentialId,
      credential.body.token
    );
    expect(accepted.status).toBe(101);
    sendMaskedText(accepted.socket, JSON.stringify({
      type: 'agent_hello',
      protocolVersion: 1,
      messageId: randomUUID(),
      sentAt: new Date().toISOString(),
      payload: {
        agent: {
          agentId,
          agentName: 'P0 runtime edge agent',
          siteCode: 'primary-site',
          softwareVersion: 'p0-runtime'
        },
        drivers: []
      }
    }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    accepted.socket.end();

    const state = await page.evaluate(async ({ accessToken, requestedAgentId, issuedCredentialId }) => {
      const headers = { Authorization: `Bearer ${accessToken}` };
      const listedBefore = await fetch(`/api/v1/edge-agents/${encodeURIComponent(requestedAgentId)}/credentials`, { headers });
      const beforeCredentials = await listedBefore.json();
      const issued = beforeCredentials.find((entry) => entry.credentialId === issuedCredentialId);
      const rotated = await fetch(
        `/api/v1/edge-agents/${encodeURIComponent(requestedAgentId)}/credentials/rotate`,
        { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'P0 runtime rotation test' }) }
      );
      const rotation = await rotated.json();
      const listedAfter = await fetch(`/api/v1/edge-agents/${encodeURIComponent(requestedAgentId)}/credentials`, { headers });
      const afterCredentials = await listedAfter.json();
      return {
        listBeforeStatus: listedBefore.status,
        listAfterStatus: listedAfter.status,
        lastUsedAt: issued?.lastUsedAt ?? null,
        rotationStatus: rotated.status,
        rotation,
        oldStatus: afterCredentials.find((entry) => entry.credentialId === issuedCredentialId)?.status ?? null,
        listContainsPlaintextToken: afterCredentials.some((entry) => Object.hasOwn(entry, 'token'))
      };
    }, { accessToken: token, requestedAgentId: agentId, issuedCredentialId: credential.body.credentialId });
    expect(state.listBeforeStatus).toBe(200);
    expect(state.listAfterStatus).toBe(200);
    expect(state.lastUsedAt).toBeTruthy();
    expect(state.rotationStatus).toBe(201);
    expect(state.rotation.credentialId).toBeTruthy();
    expect(state.rotation.token).toBeTruthy();
    expect(state.rotation.credentialId).not.toBe(credential.body.credentialId);
    expect(state.oldStatus).toBe('REVOKED');
    expect(state.listContainsPlaintextToken).toBe(false);

    const oldCredentialRejected = await edgeHandshake(
      `${baseUrl.replace(/^http/, 'ws')}/ws/edge/v1`,
      credential.body.credentialId,
      credential.body.token
    );
    expect(oldCredentialRejected.status).not.toBe(101);

    const rotatedCredentialAccepted = await edgeHandshake(
      `${baseUrl.replace(/^http/, 'ws')}/ws/edge/v1`,
      state.rotation.credentialId,
      state.rotation.token
    );
    expect(rotatedCredentialAccepted.status).toBe(101);
    rotatedCredentialAccepted.socket.end();

    const revokeStatus = await page.evaluate(async ({ accessToken, requestedAgentId, rotatedCredentialId }) => {
      const response = await fetch(
        `/api/v1/edge-agents/${encodeURIComponent(requestedAgentId)}/credentials/${encodeURIComponent(rotatedCredentialId)}/revoke`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'P0 rotation revocation test' })
        }
      );
      return response.status;
    }, { accessToken: token, requestedAgentId: agentId, rotatedCredentialId: state.rotation.credentialId });
    expect(revokeStatus).toBe(200);

    const rotatedCredentialRejected = await edgeHandshake(
      `${baseUrl.replace(/^http/, 'ws')}/ws/edge/v1`,
      state.rotation.credentialId,
      state.rotation.token
    );
    expect(rotatedCredentialRejected.status).not.toBe(101);
    await context.close();
  });
});
