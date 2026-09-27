// Serve-only entry points. Nothing here is registered as a Rollup build input.
export function motionPreviewPlugin() {
  const shell = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IoT Manager · 合成动效预览</title><link rel="stylesheet" href="/src/dev/motion-preview/preview.css"></head><body><main id="motion-preview"></main><script type="module" src="/src/dev/motion-preview/preview.js"></script></body></html>`;
  const frame = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>合成 App 场景</title><link rel="stylesheet" href="/src/css/style.css"><link rel="stylesheet" href="/src/dev/motion-preview/frame.css"></head><body><div id="app"></div><script type="module" src="/src/dev/motion-preview/frame.js"></script></body></html>`;
  return {
    name: 'iot-motion-preview-development-only',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        if (!['/__motion', '/__motion/', '/__motion/frame/'].includes(path)) return next();
        // No HTML transform: avoid injecting the Vite HMR WebSocket client into this isolated demo.
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
        response.setHeader('Permissions-Policy', 'geolocation=(), bluetooth=(), camera=(), microphone=()');
        response.end(path === '/__motion/frame/' ? frame : shell);
      });
    }
  };
}
