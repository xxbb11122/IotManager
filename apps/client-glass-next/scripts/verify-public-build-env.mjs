import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['node_modules', 'dist', 'build', '.gradle', '.git', 'test-results', 'playwright-report', 'verification']);
const forbidden = new RegExp('\\bVITE_[A-Z0-9_]*(?:' + ['TOKEN', 'SECRET', 'PASSWORD', 'PRIVATE_KEY', 'API_KEY'].join('|') + ')[A-Z0-9_]*\\b', 'g');
const findings = [];
async function inspect(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (!ignored.has(entry.name)) await inspect(file); }
    else if (/\.(?:js|mjs|json|html|ts)$/.test(entry.name) || entry.name.startsWith('.env')) {
      const contents = await readFile(file, 'utf8');
      for (const match of contents.matchAll(forbidden)) findings.push(path.relative(root, file) + ': ' + match[0]);
    }
  }
}
await inspect(root);
if (findings.length) throw new Error('Public build credential fields found: ' + findings.join(', '));
console.log('Public build environment policy passed.');
