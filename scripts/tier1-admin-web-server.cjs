// Tier 1 Admin Web real-session harness server (same contract as scripts/b9-real-session-server.cjs):
// serves the production Admin Web bundle and proxies /api/* to the REAL Nest AppModule.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const API_PORT = Number(process.env.T1_API_PORT || 4500);
const PREVIEW_PORT = Number(process.env.T1_PREVIEW_PORT || 4501);
const DIST = process.argv[2] || '/tmp/tier1-admin-dist';
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.map':'application/json; charset=utf-8'};

function sendFile(res, file) {
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}
function proxy(req, res) {
  const target = new URL(req.url, API_ORIGIN);
  const headers = { ...req.headers, host: `127.0.0.1:${API_PORT}` };
  const upstream = http.request(
    { hostname: '127.0.0.1', port: API_PORT, path: `${target.pathname}${target.search}`, method: req.method, headers },
    (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); },
  );
  upstream.on('error', (e) => { res.writeHead(502, {'content-type':'application/json'}); res.end(JSON.stringify({statusCode:502,message:`upstream unavailable: ${e.message}`})); });
  req.pipe(upstream);
}
async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error(`No bundle at ${DIST}`);
  const { NestFactory } = require(path.join(ROOT, 'node_modules/@nestjs/core'));
  const { FastifyAdapter } = require(path.join(ROOT, 'node_modules/@nestjs/platform-fastify'));
  const { ValidationPipe } = require(path.join(ROOT, 'node_modules/@nestjs/common'));
  const { AppModule } = require(path.join(ROOT, 'dist', 'app.module'));
  const app = await NestFactory.create(AppModule, new FastifyAdapter({ trustProxy: true }), { bufferLogs: false, rawBody: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.enableShutdownHooks();
  await app.listen(API_PORT, '0.0.0.0');
  const preview = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PREVIEW_PORT}`);
    if (url.pathname.startsWith('/api/')) return proxy(req, res);
    const resolved = path.resolve(path.join(DIST, decodeURIComponent(url.pathname)));
    if (!resolved.startsWith(path.resolve(DIST))) { res.writeHead(403); return res.end('forbidden'); }
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return sendFile(res, resolved);
    const index = path.join(DIST, 'index.html');
    if (fs.existsSync(index)) return sendFile(res, index);
    res.writeHead(404); res.end('bundle not found');
  });
  await new Promise((r) => preview.listen(PREVIEW_PORT, '0.0.0.0', r));
  process.stdout.write(`T1_SERVER_READY http://0.0.0.0:${PREVIEW_PORT} api=${API_ORIGIN}\n`);
  const shutdown = async () => { preview.close(); await app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch((e) => { process.stderr.write(`T1_SERVER_FAILED ${e.stack || e.message}\n`); process.exit(1); });
