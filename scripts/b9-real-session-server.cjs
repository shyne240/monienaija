#!/usr/bin/env node
'use strict';

/**
 * ARENA B9 — real-session harness server.
 *
 * Serves the production Admin Web bundle and the REAL Nest API from one origin, so a browser can
 * drive the actual workforce endpoints against a fully migrated disposable PostgreSQL instead of a
 * fixture API:
 *
 *   browser  ->  :4401  static bundle  +  /api/v1/* proxy  ->  :4400  real AppModule
 *
 * This is not `dist/main.js`: that entry point runs the production readiness gate, which refuses to
 * boot without external financial dependencies. The application graph, routes, guards, validation,
 * rate limits and persistence here are the same objects the integration suites exercise — the only
 * thing omitted is the production readiness assertion and the worker timers (disabled by env).
 *
 * Every dependency is disposable: embedded PostgreSQL on 127.0.0.1, generated credentials in
 * `.env`, and the fixture accounts created by `scripts/local-dev-seed-11-roles.js`.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API_PORT = Number(process.env.B9_API_PORT || 4400);
const PREVIEW_PORT = Number(process.env.B9_PREVIEW_PORT || 4401);
const DIST = path.resolve(process.argv[2] || '/tmp/b9-real-dist');
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function sendFile(res, file) {
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function proxy(req, res) {
  const target = new URL(req.url, API_ORIGIN);
  const headers = { ...req.headers, host: `127.0.0.1:${API_PORT}` };
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: API_PORT,
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers,
    },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 502, message: `upstream unavailable: ${error.message}` }));
  });
  req.pipe(upstream);
}

function staticServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PREVIEW_PORT}`);
    if (url.pathname.startsWith('/api/')) return proxy(req, res);
    const candidate = path.join(DIST, decodeURIComponent(url.pathname));
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(path.resolve(DIST))) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return sendFile(res, resolved);
    const index = path.join(DIST, 'index.html');
    if (fs.existsSync(index)) return sendFile(res, index);
    res.writeHead(404);
    res.end('bundle not found');
  });
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(`No built Admin Web bundle at ${DIST}`);
  }
  const { NestFactory } = require('@nestjs/core');
  const { FastifyAdapter } = require('@nestjs/platform-fastify');
  const { ValidationPipe } = require('@nestjs/common');
  const { AppModule } = require(path.join(__dirname, '..', 'dist', 'app.module'));
  const { RequestTrackerService } = require(
    path.join(__dirname, '..', 'dist', 'production', 'request-tracker.service'),
  );
  const { registerRequestContextHooks } = require(
    path.join(__dirname, '..', 'dist', 'production', 'request-hooks'),
  );

  const app = await NestFactory.create(AppModule, new FastifyAdapter({ trustProxy: true }), {
    bufferLogs: false,
    rawBody: true,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  registerRequestContextHooks(app.getHttpAdapter().getInstance(), {
    requestTracker: app.get(RequestTrackerService),
    apiVersion: (process.env.API_VERSION || 'v1').replace(/^v/, ''),
  });
  app.enableShutdownHooks();
  await app.listen(API_PORT, '0.0.0.0');

  const preview = staticServer();
  await new Promise((resolve) => preview.listen(PREVIEW_PORT, '0.0.0.0', resolve));

  process.stdout.write(`B9_SERVER_READY http://0.0.0.0:${PREVIEW_PORT} api=${API_ORIGIN}\n`);

  const shutdown = async () => {
    preview.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  process.stderr.write(`B9_SERVER_FAILED ${error.stack || error.message}\n`);
  process.exit(1);
});
