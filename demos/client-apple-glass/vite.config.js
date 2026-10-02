import { defineConfig } from 'vite';
export default defineConfig({
  // Relative assets make dist portable to another local static host.
  base: './',
  define: { __IOT_BUILD_INFO__: JSON.stringify({ version: 'glass-demo 1.2.0', commit: 'isolated-demo', dirty: false, builtAt: '2026-10-02' }) },
  server: { fs: { strict: true }, headers: { 'X-Content-Type-Options': 'nosniff' } },
  build: { outDir: 'dist', emptyOutDir: true }
});
