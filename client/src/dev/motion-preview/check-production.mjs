import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { motionPreviewPlugin } from './dev-plugin.js';

const output = fileURLToPath(new URL('../../../dist/', import.meta.url));
const forbidden = ['iot-motion-preview-ready', 'iot-motion-preview-update', '合成动效预览', '/__motion/', 'synthetic.invalid'];
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : join(directory, entry.name)))).flat();
}

if (motionPreviewPlugin().apply !== 'serve') throw new Error('Preview plugin must remain serve-only.');
const assets = await files(output);
const findings = [];
for (const path of assets) {
  if (/motion-preview|__motion/.test(relative(output, path))) findings.push(relative(output, path));
  if (!/\.(?:html|js|css|map|json)$/.test(path)) continue;
  const contents = await readFile(path, 'utf8');
  for (const marker of forbidden) if (contents.includes(marker)) findings.push(`${relative(output, path)} contains ${marker}`);
}
if (findings.length) throw new Error(`Development preview leaked into production output:\n${findings.join('\n')}`);
console.log(`Production isolation verified: ${assets.length} output files; no preview entry, fixture host or preview runtime markers.`);
