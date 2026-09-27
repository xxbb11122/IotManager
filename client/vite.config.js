import { defineConfig } from 'vite';
import { motionPreviewPlugin } from './src/dev/motion-preview/dev-plugin.js';

export default defineConfig({
  root: '.',
  plugins: [motionPreviewPlugin()],
  server: {
    port: 5175,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true }
    }
  },
  build: { outDir: 'dist', assetsDir: 'assets', emptyOutDir: true }
});
