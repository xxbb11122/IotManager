import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5175,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true }
    }
  },
  build: { outDir: 'dist', assetsDir: 'assets', emptyOutDir: true }
});
