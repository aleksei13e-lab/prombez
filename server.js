// Сервер для Render (и любого хостинга с Node.js): раздаёт public/ и запускает
// те же функции из netlify/functions, что и на Netlify. Зависимостей не требует.
//
// Хранилище: на Render используется файловый адаптер (см. _lib/store.js).
// Чтобы кроссворды не пропадали при перезапуске, к сервису нужен Persistent Disk,
// а PB_LOCAL_DIR должен указывать на папку диска (например, /var/data).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import generate from './netlify/functions/generate.js';
import crosswordCreate from './netlify/functions/crossword-create.js';
import crosswordGet from './netlify/functions/crossword-get.js';
import manage from './netlify/functions/manage.js';
import check from './netlify/functions/check.js';
import hint from './netlify/functions/hint.js';
import bank from './netlify/functions/bank.js';
import sweep from './netlify/functions/sweep.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 10000;
const MAX_BODY = 256 * 1024;

// Маршруты API: [метод(ы), шаблон пути, обработчик, имя параметра]
const ROUTES = [
  [['POST'], /^\/api\/generate$/, generate, null],
  [['POST'], /^\/api\/crossword$/, crosswordCreate, null],
  [['GET'], /^\/api\/crossword\/([^/]+)$/, crosswordGet, 'id'],
  [['GET', 'PUT', 'DELETE'], /^\/api\/crossword\/([^/]+)\/manage$/, manage, 'id'],
  [['POST'], /^\/api\/check$/, check, null],
  [['POST'], /^\/api\/hint$/, hint, null],
  [['GET'], /^\/api\/bank\/([^/]+)$/, bank, 'theme']
];

// Чистые URL страниц (как redirects в netlify.toml)
const PAGES = [
  [/^\/play\/.*$/, 'play.html'],
  [/^\/generator\/?$/, 'generator.html'],
  [/^\/teacher\/?$/, 'teacher.html']
];

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function runApi(req, res, url, handler, param, value) {
  // Параметр маршрута передаём query-параметром, как это делали редиректы Netlify
  const target = new URL(url.href);
  if (param) target.searchParams.set(param, value);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    try { headers.set(k, Array.isArray(v) ? v.join(', ') : v); } catch { /* служебный заголовок */ }
  }
  if (!headers.get('x-forwarded-for') && req.socket.remoteAddress) {
    headers.set('x-forwarded-for', req.socket.remoteAddress);
  }
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try { body = await readBody(req); }
    catch {
      return send(res, 413, JSON.stringify({ error: 'too_large', message: 'Слишком большой запрос' }),
        { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    }
  }
  const request = new Request(target, { method: req.method, headers, body });
  let response;
  try {
    response = await handler(request, { params: param ? { [param]: value } : {}, ip: req.socket.remoteAddress });
  } catch (err) {
    console.error('handler error:', err?.message || err);
    response = new Response(JSON.stringify({ error: 'server', message: 'Внутренняя ошибка сервера' }), {
      status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  const out = {};
  response.headers.forEach((v, k) => { out[k] = v; });
  const buf = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, { ...SECURITY_HEADERS, ...out });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Страница не найдена', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(file).toLowerCase();
    const etag = `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      ETag: etag,
      // Небольшой кэш: после обновления сайта новые файлы подхватываются в течение минут
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
    };
    if (req.headers['if-none-match'] === etag) return send(res, 304, undefined, { ETag: etag });
    res.writeHead(200, { ...SECURITY_HEADERS, ...headers });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    const url = new URL(req.url, `${proto}://${host}`);
    const pathname = url.pathname;

    if (pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });

    if (pathname.startsWith('/api/')) {
      for (const [methods, re, handler, param] of ROUTES) {
        const m = re.exec(pathname);
        if (!m) continue;
        if (!methods.includes(req.method)) {
          return send(res, 405, JSON.stringify({ error: 'method', message: 'Метод не поддерживается' }),
            { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Allow: methods.join(', ') });
        }
        let value = null;
        if (param) { try { value = decodeURIComponent(m[1]); } catch { value = m[1]; } }
        return await runApi(req, res, url, handler, param, value);
      }
      return send(res, 404, JSON.stringify({ error: 'not_found', message: 'Не найдено' }),
        { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');

    for (const [re, file] of PAGES) {
      if (re.test(pathname)) return serveFile(req, res, path.join(PUBLIC, file));
    }

    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad Request'); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
    return serveFile(req, res, file);
  } catch (err) {
    console.error('server error:', err?.message || err);
    if (!res.headersSent) send(res, 500, 'Internal Server Error', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

// Ежедневная очистка кроссвордов без обращений 180 дней (вместо Netlify Scheduled Functions)
async function runSweep() {
  try { await sweep(); } catch (err) { console.error('sweep error:', err?.message || err); }
}
setTimeout(runSweep, 60 * 1000).unref();
setInterval(runSweep, 24 * 3600 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => {
  const dir = process.env.PB_LOCAL_DIR || '.local-store';
  console.log(`ПромБезКроссворд слушает порт ${PORT}; хранилище: ${dir}`);
});
