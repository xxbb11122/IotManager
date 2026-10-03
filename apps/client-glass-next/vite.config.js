import { defineConfig, loadEnv } from 'vite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Agent } from 'node:https';
import { lookup } from 'node:dns';
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, clientRoot, '');
  const apiTarget = env.IOT_DEV_API_TARGET || 'http://localhost:8080';
  const target = new URL(apiTarget);
  const agent = target.protocol === 'https:' && env.IOT_DEV_CA_FILE ? new Agent({
    ca: readFileSync(env.IOT_DEV_CA_FILE),
    lookup(hostname, options, callback) {
      if (hostname !== 'iot-manager.localhost') return lookup(hostname, options, callback);
      if (options.all) return callback(null, [{ address: '127.0.0.1', family: 4 }]);
      callback(null, '127.0.0.1', 4);
    }
  }) : undefined;
  const proxy = { target: apiTarget, changeOrigin: true, secure: true, agent,
    ...(env.IOT_DEV_API_TARGET ? { headers: { Origin: target.origin } } : {}) };
  return {
  root: '.',
  define: { __IOT_BUILD_INFO__: JSON.stringify(buildInfo) },
  plugins: [motionPreviewPlugin(), {
    name: 'public-build-identity',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(buildInfo, null, 2) }); }
  }, {
    name: 'glass-third-party-notices',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'third-party-notices.txt',
        source: readFileSync(new URL('./THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8') });
    }
  }],
  server: {
    port: 5190,
    proxy: {
      '/api': { ...proxy },
      '/ws': { ...proxy, ws: true }
    }
  },
  build: { outDir: 'dist', assetsDir: 'assets', emptyOutDir: true }
  };
});
