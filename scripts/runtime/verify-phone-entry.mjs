import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash, X509Certificate } from 'node:crypto';

// Public resources and anonymous PKCE forms only. No account, Chat or token.
const configuredOrigin = process.env.IOT_PHONE_ORIGIN;
if (!configuredOrigin) {
  throw new Error('Set IOT_PHONE_ORIGIN to the phone-facing HTTPS origin before running this check.');
}
const origin = new URL(configuredOrigin);
assert.equal(origin.protocol, 'https:');
assert.ok(!origin.username && !origin.password && origin.pathname === '/' && !origin.search);
const ca = await readFile(process.env.IOT_PHONE_CA_FILE ?? 'deploy/.runtime/iot-manager-p0/phone-web/mobile/caddy-root-ca.cer');
const publicConfig = JSON.parse(await readFile('artifacts/phone-lan-20261003/connection.json', 'utf8'));
const issuer = new URL('/auth/realms/iot-manager', origin).href;
const checks = [];
function get(address, { method = 'GET', headers = {} } = {}) {
  const url = new URL(address, origin);
  assert.equal(url.hostname, origin.hostname);
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url,
      { ca, method, headers, timeout: 12000, autoSelectFamily: false }, res => {
        const chunks = []; let length = 0;
        res.on('data', chunk => { chunks.push(chunk); length += chunk.length;
          if (length > 16 * 1024 * 1024) req.destroy(new Error('Unexpected public resource size')); });
        res.on('end', () => { const bytes = Buffer.concat(chunks); resolve({
          status: res.statusCode, headers: res.headers, bytes, body: bytes.toString('utf8') }); });
        res.on('error', reject);
      });
    req.on('timeout', () => req.destroy(new Error('Phone ingress check timed out')));
    req.on('error', reject); req.end();
  });
}

const page = await get('/glass/');
assert.equal(page.status, 200);
assert.match(page.headers['content-security-policy'], /script-src 'self'(?:;|$)/);
const scripts = [...page.body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
assert.ok(scripts.length >= 2 && scripts.every(([, attributes, source]) => /\bsrc=/.test(attributes) && !source.trim()));
checks.push('Phone Glass HTML and external startup scripts match CSP');
const resources = [...new Set([...page.body.matchAll(/(?:src|href)="(\/glass\/[^"?#]+\.(?:js|css))"/g)].map(match => match[1]))];
assert.ok(resources.some(path => path.includes('startup-watchdog')));
let configuredIssuer = false;
for (const path of resources) {
  const asset = await get(path);
  assert.equal(asset.status, 200, path);
  assert.ok(!asset.body.startsWith('<!doctype html>'));
  if (asset.body.includes(issuer) && asset.body.includes('iot-glass-next')) configuredIssuer = true;
}
assert.ok(configuredIssuer, 'Browser bundle must use the reachable issuer');
assert.equal(JSON.parse((await get('/glass/build-info.json')).body).version, publicConfig.applicationVersion);
checks.push('Glass assets and build identity match the LAN issuer and client');
const me = await get('/api/v1/me');
assert.equal(me.status, 401);
checks.push('LAN API reachable over verified TLS and still requires login');
const cors = await get('/api/v1/sites/1/ai/chat', { method: 'OPTIONS', headers: {
  Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST',
  'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' } });
assert.ok([200, 204].includes(cors.status));
assert.equal(cors.headers['access-control-allow-origin'], 'https://localhost');
const untrustedOrigin = await get('/api/v1/me', { method: 'OPTIONS', headers: {
  Origin: 'https://untrusted.example.test', 'Access-Control-Request-Method': 'GET' } });
assert.equal(untrustedOrigin.status, 403);
checks.push('Android origin accepted; untrusted browser origin rejected');
assert.equal((await get('/actuator/health')).status, 404);
checks.push('Private runtime endpoints remain inaccessible');
const discovery = await get(issuer + '/.well-known/openid-configuration');
assert.equal(discovery.status, 200);
const metadata = JSON.parse(discovery.body);
assert.equal(metadata.issuer, issuer);
for (const field of ['authorization_endpoint', 'token_endpoint', 'end_session_endpoint'])
  assert.equal(new URL(metadata[field]).origin, origin.origin);
checks.push('OIDC discovery and login/token endpoints use the phone address');
const callbacks = [
  ['iot-glass-next', new URL('/glass/', origin).href],
  ['iot-glass-next', 'com.iot.manager.glassnext://oauth/callback'],
  ['iot-glass-next', 'http://127.0.0.1:5190/'],
  ['iot-mobile', 'com.iot.manager.client://oauth/callback'],
  ['iot-web', new URL('/app/', origin).href]
];
for (const [client, redirect] of callbacks) {
  const authorization = new URL(metadata.authorization_endpoint);
  authorization.search = new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: 'code',
    scope: 'openid', state: 'phone-entry-check', code_challenge: 'A'.repeat(43), code_challenge_method: 'S256' }).toString();
  const form = await get(authorization.href);
  assert.equal(form.status, 200, client + ' / ' + redirect);
  assert.match(form.body, /name="username"/);
}
checks.push('Five native/browser public-client callbacks reach PKCE login forms');
const bootstrap = await get(new URL('/mobile/', origin).href.replace('https:', 'http:'));
assert.equal(bootstrap.status, 200);
const certificateDownload = await get(publicConfig.ca);
assert.equal(certificateDownload.status, 200);
assert.equal(new X509Certificate(certificateDownload.bytes).fingerprint256, new X509Certificate(ca).fingerprint256);
checks.push('Public CA bootstrap download matches the trusted server CA');
const apk = await get(publicConfig.apk);
assert.equal(apk.status, 200);
assert.equal(createHash('sha256').update(apk.bytes).digest('hex').toUpperCase(), publicConfig.apkSha256);
checks.push('HTTPS APK download matches the built phone package');
const result = { origin: origin.origin, certificateAndIpVerified: true, checks,
  version: publicConfig.applicationVersion, providerCalls: 0, credentialsUsed: false,
  actualPhoneVerified: false, authenticatedChatVerified: false };
await writeFile(process.env.IOT_PHONE_EVIDENCE_FILE ?? 'artifacts/phone-lan-20261003/entry-check.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
