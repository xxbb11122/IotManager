import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchLegacyCache } from './rollback-cache-patch.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(appRoot, '../..');
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
const baseline = value('--baseline'), output = value('--output'), code = Number(value('--version-code'));
const gradle = readFileSync(resolve(appRoot, 'android/app/build.gradle'), 'utf8');
const currentCode = Number(gradle.match(/def resolvedVersionCode = (\d+)/)?.[1]);
const contained = (parent, path) => { const part = relative(parent, path); return part === '' || (!part.startsWith('..') && !isAbsolute(part)); };
if (!args.includes('--baseline') || !/^[a-f0-9]{40}$/.test(baseline ?? '') || !args.includes('--output') || !output ||
    !Number.isInteger(code) || code <= currentCode || code > 2100000000) {
  throw new Error('Use --baseline <full SHA> --output <new directory> --version-code <greater than current code>');
}
const target = resolve(output);
if (existsSync(target) || contained(appRoot, target) || contained(resolve(root, 'client'), target) || contained(resolve(root, '.git'), target)) {
  throw new Error('Output must be a new directory outside application source and .git');
}
execFileSync('git', ['cat-file', '-e', `${baseline}^{commit}`], { cwd: root, stdio: 'pipe', windowsHide: true });
// Reject an incompatible baseline before creating any output.
const cachePath = 'apps/client-glass-next/src/js/platform/cache-repository.js';
const oldCache = execFileSync('git', ['show', `${baseline}:${cachePath}`], { cwd: root, encoding: 'utf8', windowsHide: true });
const patched = patchLegacyCache(oldCache);
mkdirSync(target, { recursive: true });
const archive = resolve(target, 'baseline.tar');
execFileSync('git', ['archive', '--format=tar', '--output', archive, baseline, 'apps/client-glass-next'], { cwd: root, windowsHide: true });
execFileSync('tar', ['-xf', archive, '-C', target], { windowsHide: true });
unlinkSync(archive);
const exported = resolve(target, 'apps/client-glass-next');
writeFileSync(resolve(target, cachePath), patched);
copyFileSync(resolve(appRoot, 'src/js/platform/cache-schema.js'), resolve(exported, 'src/js/platform/cache-schema.js'));
// Rebuild the old business code with the reviewed current dependency graph.
const name = `1.1.4-glass.rollback.${code}`;
const pkg = JSON.parse(readFileSync(resolve(appRoot, 'package.json')));
const lock = JSON.parse(readFileSync(resolve(appRoot, 'package-lock.json')));
pkg.version = name; lock.version = name; lock.packages[''].version = name;
writeFileSync(resolve(exported, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
writeFileSync(resolve(exported, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
const oldGradle = readFileSync(resolve(exported, 'android/app/build.gradle'), 'utf8');
if (!oldGradle.includes('applicationId "com.iot.manager.glassnext"') || !/def resolvedVersionCode = \d+/.test(oldGradle) ||
    !/def resolvedVersionName = configuredVersionName \?: '[^']+'/.test(oldGradle)) throw new Error('Unsupported baseline Android identity');
writeFileSync(resolve(exported, 'android/app/build.gradle'), oldGradle
  .replace(/def resolvedVersionCode = \d+/, `def resolvedVersionCode = ${code}`)
  .replace(/def resolvedVersionName = configuredVersionName \?: '[^']+'/, `def resolvedVersionName = configuredVersionName ?: '${name}'`));
// Preserve the browser targets when upgrading the historical build toolchain.
const viteFile = resolve(exported, 'vite.config.js');
writeFileSync(viteFile, readFileSync(viteFile, 'utf8').replace(/build: \{/, "build: { target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],"));
const digest = path => createHash('sha256').update(readFileSync(resolve(exported, path))).digest('hex');
const manifest = { status: 'NOT_SIGNED_NOT_VALIDATED', baseline, remediationHead: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding:'utf8'}).trim(),
  remediationDirty: execFileSync('git', ['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim().length > 0,
  appId: 'com.iot.manager.glassnext', versionCode: code, versionName: name,
  requirements: ['same production signing certificate', 'versionCode greater than every installed build', 'signed APK identity check', 'physical upgrade/rollback acceptance'],
  hashes: Object.fromEntries(['src/js/platform/cache-repository.js', 'src/js/platform/cache-schema.js', 'package-lock.json', 'android/app/build.gradle', 'vite.config.js'].map(path => [path, digest(path)])) };
writeFileSync(resolve(target, 'rollback-source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ status: manifest.status, appRoot: exported, versionCode: code, manifest: resolve(target, 'rollback-source-manifest.json') }));
