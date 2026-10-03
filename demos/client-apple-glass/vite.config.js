import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
export default defineConfig({
  // Relative assets make dist portable to another local static host.
  base: './',
  define: { __IOT_BUILD_INFO__: JSON.stringify({ version: 'glass-demo 1.2.0', commit: 'isolated-demo', dirty: false, builtAt: '2026-10-02' }) },
  server: { fs: { strict: true }, headers: { 'X-Content-Type-Options': 'nosniff' } },
  plugins: [{
    name: 'demo-third-party-notices',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'third-party-notices.txt',
        source: readFileSync(new URL('./THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8') });
    }
  }],
  build: { outDir: 'dist', emptyOutDir: true }
});
