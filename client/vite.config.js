import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { motionPreviewPlugin } from './src/dev/motion-preview/dev-plugin.js';

const clientRoot = fileURLToPath(new URL('.', import.meta.url));
function git(...args) {
  try { return execFileSync('git', args, { cwd: clientRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
const revision = git('rev-parse', 'HEAD');
const status = git('status', '--porcelain');
const buildInfo = {
  commit: /^[a-f0-9]{40}$/.test(revision ?? '') ? revision : 'unknown',
  builtAt: new Date().toISOString(),
  dirty: status === null || status.length > 0,
  version: JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
};

export default defineConfig({
  root: '.',
  define: { __IOT_BUILD_INFO__: JSON.stringify(buildInfo) },
  plugins: [motionPreviewPlugin(), {
    name: 'public-build-identity',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(buildInfo, null, 2) }); }
  }],
  server: {
    port: 5175,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true }
    }
  },
  build: { outDir: 'dist', assetsDir: 'assets', emptyOutDir: true }
});
