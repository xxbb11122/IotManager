// Dependency-free, loopback-only server for the prebuilt demo.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../dist');
const port = Number(process.env.GLASS_DEMO_PORT ?? 5188);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('GLASS_DEMO_PORT must be 1024–65535.');
await fs.access(path.join(root, 'index.html')).catch(() => { throw new Error('Missing dist. Run npm ci and npm run build first.'); });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const data = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 400).end('Demo resource unavailable'); }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Stop the other demo terminal or set GLASS_DEMO_PORT.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Glass demo: http://127.0.0.1:${port}/\nAll data is simulated. Press Ctrl+C to stop.`));
