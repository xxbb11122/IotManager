import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Explicit opt-in: one small, paid remote Chat call, without site data.
if (process.env.IOT_LIVE_AI_ACCEPTANCE !== 'true') throw new Error('Set IOT_LIVE_AI_ACCEPTANCE=true for the authorized provider check.');
const root = new URL('../../', import.meta.url);
const environment = await readFile(new URL('deploy/.env.integration', root), 'utf8');
function setting(name, fallback) {
  const rows = environment.split(/\r?\n/).filter(line => line.trim().startsWith(name + '='));
  return rows.at(-1)?.slice(rows.at(-1).indexOf('=') + 1).trim() || fallback;
}
const model = setting('IOT_AI_CHAT_MODEL', 'deepseek-flash');
const baseUrl = new URL(setting('IOT_AI_CHAT_BASE_URL', 'https://api.deepseek.com'));
const allowed = setting('IOT_AI_ALLOWED_HOSTS', 'api.deepseek.com').split(',').map(value => value.trim());
if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || !allowed.includes(baseUrl.hostname))
  throw new Error('Provider URL must be HTTPS and on the configured host allowlist.');
const path = setting('IOT_AI_CHAT_COMPLETIONS_PATH', '/chat/completions');
if (!path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#')) throw new Error('Unexpected Chat path.');
const endpoint = new URL(baseUrl.href.replace(/\/$/, '') + path);
if (endpoint.origin !== baseUrl.origin) throw new Error('Provider origin changed.');
const key = (await readFile(new URL('deploy/.runtime/iot-manager-p0/secrets/ai_chat_api_key', root), 'utf8')).trim();
if (!key || /\s/.test(key)) throw new Error('Protected Chat credential is unavailable.');
const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
  headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, stream: false, max_tokens: 1024, messages: [
    { role: 'user', content: '请只用一句话解释温度传感器。' }
  ] }) });
const payload = await response.json().catch(() => ({}));
const answer = payload.choices?.[0]?.message?.content;
const result = {
  kind: 'direct-provider-connectivity', httpStatus: response.status, configuredModel: model,
  answerNonempty: typeof answer === 'string' && answer.trim().length > 0,
  answerCharacters: typeof answer === 'string' ? answer.length : 0,
  finishReason: payload.choices?.[0]?.finish_reason ?? null,
  totalTokens: Number.isFinite(payload.usage?.total_tokens) ? payload.usage.total_tokens : null,
  providerCalls: 1, embeddingCalls: 0, siteDataSent: false, credentialsLogged: false,
  appEndToEndVerified: false
};
if (process.env.IOT_AI_PROVIDER_EVIDENCE_FILE) await writeFile(fileURLToPath(new URL(process.env.IOT_AI_PROVIDER_EVIDENCE_FILE, root)), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!response.ok || !result.answerNonempty) process.exitCode = 1;
