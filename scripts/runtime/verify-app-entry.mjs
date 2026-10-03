import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';

// Read-only deployment check. It neither signs in nor calls Chat.
const origin = new URL(process.env.IOT_APP_ORIGIN ?? 'https://iot-manager.localhost');
assert.equal(origin.protocol, 'https:');
assert.ok(!origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash);
const ca = process.env.IOT_APP_CA_FILE ? await readFile(process.env.IOT_APP_CA_FILE) : undefined;
const version = JSON.parse(await readFile(new URL('../../client/package.json', import.meta.url), 'utf8')).version;
const checks = [];
function get(path) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin.origin, 'Only same-origin public deployment resources are inspected');
  return new Promise((resolve, reject) => {
    const options = { ca, method: 'GET', timeout: 10000, autoSelectFamily: false };
    if (url.hostname === 'iot-manager.localhost') options.lookup = (_host, _options, callback) => callback(null, '127.0.0.1', 4);
    const req = request(url, options, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 2_000_000) req.destroy(new Error('Unexpectedly large public resource'));
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Public resource check timed out')));
    req.on('error', reject);
    req.end();
  });
}
const root = await get('/app');
assert.equal(root.status, 301);
assert.equal(new URL(root.headers.location, origin).pathname, '/app/');
checks.push('App root redirects to /app/');
const page = await get('/app/');
assert.equal(page.status, 200);
assert.match(page.headers['content-type'], /text\/html/);
assert.match(page.headers['content-security-policy'], /script-src 'self'(?:;|$)/);
const scripts = [...page.body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
assert.ok(scripts.length >= 2);
assert.ok(scripts.every(([, attributes, code]) => /\bsrc=/.test(attributes) && !code.trim()), 'Startup scripts must work with the deployed CSP');
checks.push('App HTML and external startup scripts match the CSP');
const assets = [...new Set([...page.body.matchAll(/(?:src|href)="(\/app\/[^"?#]+\.(?:js|css))"/g)].map(match => match[1]))];
const webClient = 'iot-web';
let hasConfiguredClient = false;
assert.ok(assets.some(path => path.endsWith('/startup-watchdog.js')));
assert.ok(assets.some(path => path.endsWith('.css')));
for (const path of assets) {
  const asset = await get(path);
  assert.equal(asset.status, 200, path);
  assert.match(asset.headers['content-type'], path.endsWith('.css') ? /text\/css/ : /(?:text|application)\/javascript/, path);
  assert.ok(!asset.body.startsWith('<!doctype html>'), 'A missing asset must not be mistaken for SPA HTML');
  if (path.endsWith('.js') && asset.body.includes(webClient)) hasConfiguredClient = true;
}
assert.ok(hasConfiguredClient, 'App bundle must use the public client registered in the project realm');
checks.push(`${assets.length} App script and style resources resolve under /app/`);
const info = await get('/app/build-info.json');
assert.equal(info.status, 200);
assert.equal(JSON.parse(info.body).version, version);
checks.push(`Deployed App version is ${version}`);
const issuer = new URL('/auth/realms/' + (process.env.KEYCLOAK_REALM ?? 'iot-manager'), origin).href;
const discovery = await get(issuer + '/.well-known/openid-configuration');
assert.equal(discovery.status, 200);
assert.equal(JSON.parse(discovery.body).issuer, issuer);
checks.push('Public OIDC discovery matches the deployment issuer');
const loginUrl = new URL(JSON.parse(discovery.body).authorization_endpoint);
loginUrl.search = new URLSearchParams({ client_id: webClient, redirect_uri: new URL('/app/', origin).href,
  response_type: 'code', scope: 'openid', state: 'app-entry-probe', code_challenge: 'A'.repeat(43), code_challenge_method: 'S256' }).toString();
const login = await get(loginUrl.href);
assert.equal(login.status, 200, 'Configured App client and callback must reach the login form');
assert.match(login.body, /name="username"/);
checks.push('Configured App client and callback reach the PKCE login form');
const unauthenticated = await get('/api/v1/me');
assert.equal(unauthenticated.status, 401);
checks.push('Protected API still requires authentication');
const result = { version, entryUrl: new URL('/app/', origin).href, certificateAndHostnameVerified: true,
  checks, providerCalls: 0, credentialsUsed: false, authenticatedAppChatVerified: false };
if (process.env.IOT_APP_ENTRY_EVIDENCE_FILE) await writeFile(process.env.IOT_APP_ENTRY_EVIDENCE_FILE, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
