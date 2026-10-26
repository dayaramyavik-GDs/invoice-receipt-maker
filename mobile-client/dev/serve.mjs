// Browser dev server: serves www/ with a SQLite shim so the UI can be tested without a phone.
// Usage: npm run dev  →  http://localhost:8000   (API at http://localhost:3000, or set API_ORIGIN)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.env.PORT || 8000);
const API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:3000';
const BASE = resolve(import.meta.dirname, '..');
const ROOT = join(BASE, 'www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm' };
const DEV_FILES = {
  '/cordova.js': join(BASE, 'dev/cordova-shim.js'),
  '/__dev/sql-wasm.js': join(BASE, 'node_modules/sql.js/dist/sql-wasm.js'),
  '/__dev/sql-wasm.wasm': join(BASE, 'node_modules/sql.js/dist/sql-wasm.wasm'),
};

async function devIndex() {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  return html
    .replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'")
    .replace("connect-src 'self'", `connect-src 'self' ${API_ORIGIN}`)
    .replace('<script src="cordova.js"></script>', '<script src="/__dev/sql-wasm.js"></script>\n  <script src="/cordova.js"></script>');
}

async function devShim() {
  const js = await readFile(DEV_FILES['/cordova.js'], 'utf8');
  return js.replace("'http://localhost:3000'", JSON.stringify(API_ORIGIN));
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(await devIndex());
      return;
    }
    if (path === '/cordova.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }).end(await devShim());
      return;
    }
    const file = DEV_FILES[path] || resolve(join(ROOT, normalize(path)));
    if (!DEV_FILES[path] && !file.startsWith(ROOT)) throw Object.assign(new Error('Forbidden'), { code: 'EACCES' });
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch (e) {
    res.writeHead(e.code === 'EACCES' ? 403 : 404).end('Not found');
  }
}).listen(PORT, () => console.log(`Dev server on http://localhost:${PORT}`));
