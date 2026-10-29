import { Writable } from 'node:stream';

import { BadRequestException, Controller, Get, Module, type LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Response as InjectResponse } from 'light-my-request';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

import { REDACTED_VALUE } from '../src/common/sensitive-data-redaction';
import { GlobalExceptionFilter } from '../src/http-exception.filter';
import { buildPinoHttpOptions } from '../src/production/pino-config';
import { registerRequestContextHooks } from '../src/production/request-hooks';

/**
 * Arena 4 report 25 — cross-boundary end-to-end reproductions (Phase 4 mandate):
 * secrets and client-controlled diagnostic data must not escape through ANY
 * application-controlled output boundary — response bodies, response headers,
 * structured request logs (pino-http with the PRODUCTION options), exception logs,
 * correlation/trace context, or the SERVICE_DRAINING availability path — while
 * legitimate requests, identifiers and error diagnostics keep working.
 *
 * This spec wires the REAL production boundary code (extracted verbatim in report 25):
 * `registerRequestContextHooks` (main.ts onRequest/onResponse hooks) and
 * `buildPinoHttpOptions` (AppModule pino-http wiring) into a live NestJS + Fastify
 * application driven via `http.inject`, with `GlobalExceptionFilter` as the global
 * filter. It is deliberately not a unit test of `redactSensitiveText`.
 *
 * All credentials are synthetic.
 */

const LOWER_BEARER = 'abcdefgh'; // valid lowercase b64token, synthetic
const SHORT_BASIC = 'dTpw'; // base64('u:p') — valid short Basic credential, synthetic
const QUERY_SENTINEL = 'QSENT_REPORT25_E2E';
const AUTH_SENTINEL = 'AUTH_SENTINEL_REPORT25';

@Controller('report25')
class Report25E2EController {
  @Get('ok')
  ok(): Record<string, boolean> {
    return { ok: true };
  }

  @Get('item/:itemId')
  item(): Record<string, boolean> {
    return { ok: true };
  }

  @Get('boom')
  boom(): never {
    throw new Error(`upstream auth failed: bearer ${LOWER_BEARER}`);
  }

  @Get('bad')
  bad(): never {
    throw new BadRequestException({ message: 'bad input', error: `bearer ${LOWER_BEARER}` });
  }
}

@Module({ controllers: [Report25E2EController] })
class Report25E2EModule {}

interface LoggerErrorCall {
  payload: Record<string, unknown>;
  message: unknown;
}

interface E2EHarness {
  inject(options: {
    method: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
  }): Promise<InjectResponse>;
  logText(): string;
  loggerCalls(): LoggerErrorCall[];
  tracker: { started: number; finished: number };
}

const createdApps: Array<NestFastifyApplication> = [];

async function buildE2EApp(options: { draining?: boolean } = {}): Promise<E2EHarness> {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding: string, callback: (error?: Error | null) => void) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  const moduleRef = await Test.createTestingModule({ imports: [Report25E2EModule] }).compile();
  const pinoOptions = buildPinoHttpOptions();
  // Production runs the FastifyAdapter without a fastify-level logger, which
  // makes fastify's own `incoming request`/`request completed` lines and the
  // onResponse hook's `request.log` silent no-ops. This harness deliberately
  // wires fastify's `loggerInstance` into the same capture stream — with the
  // PRODUCTION serializers — so those logging sinks are OBSERVABLE and
  // permanently tested: if the fastify logger is ever enabled in production,
  // every line must already be clean.
  const fastifyLogger = pino(
    { level: 'info', redact: pinoOptions.redact, serializers: pinoOptions.serializers },
    stream,
  );
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ loggerInstance: fastifyLogger }),
    { logger: false },
  );
  createdApps.push(app);
  app.setGlobalPrefix('api/v1');

  const loggerCalls: LoggerErrorCall[] = [];
  const captureLogger: LoggerService = {
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    error: jest.fn((payload: unknown, message?: unknown) => {
      loggerCalls.push({ payload: payload as Record<string, unknown>, message });
    }),
  };
  app.useGlobalFilters(new GlobalExceptionFilter(captureLogger));

  const http = app.getHttpAdapter().getInstance();
  const tracker = {
    started: 0,
    finished: 0,
    start(): boolean {
      tracker.started += 1;
      return !options.draining;
    },
    finish(): void {
      tracker.finished += 1;
    },
  };

  // Production wiring order: main.ts registers the context hooks before the
  // nestjs-pino middleware is bound during app.init(). nestjs-pino applies
  // pino-http's express-style middleware (req, res, next) with the raw Node
  // objects, so this bridge invokes it exactly like the Nest middleware layer.
  registerRequestContextHooks(http, { requestTracker: tracker, apiVersion: 'v1' });
  const logger = pino(
    { level: 'info', redact: pinoOptions.redact, serializers: pinoOptions.serializers },
    stream,
  );
  const httpLogger = pinoHttp({ ...pinoOptions, logger });
  http.addHook('onRequest', (request, reply, done) => {
    httpLogger(request.raw, reply.raw, done);
  });
  await app.init();

  return {
    inject: (requestOptions) => http.inject(requestOptions),
    logText: () => chunks.join(''),
    loggerCalls: () => loggerCalls,
    tracker,
  };
}

afterEach(async () => {
  while (createdApps.length > 0) {
    const app = createdApps.pop();
    await app?.close();
  }
});

describe('report 25 — legitimate lifecycle is preserved end-to-end', () => {
  it('a clean request keeps status, body, identity headers, logs and tracker accounting', async () => {
    const harness = await buildE2EApp();
    const res = await harness.inject({
      method: 'GET',
      url: '/api/v1/report25/ok',
      headers: {
        'x-correlation-id': 'corr-report25-e2e-42',
        'x-trace-id': 'trace-report25-e2e-7',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body) as unknown).toEqual({ ok: true });
    expect(res.headers['x-correlation-id']).toBe('corr-report25-e2e-42');
    expect(res.headers['x-trace-id']).toBe('trace-report25-e2e-7');
    expect(res.headers['x-api-version']).toBe('v1');
    expect(typeof res.headers['x-request-id']).toBe('string');
    // Traceability: the legitimate correlation id still appears in request logs.
    expect(harness.logText()).toContain('corr-report25-e2e-42');
    expect(harness.logText()).toContain('request completed');
    expect(harness.tracker.started).toBe(1);
    expect(harness.tracker.finished).toBe(1);
  }, 15000);
});

describe('report 25 — credential-bearing correlation/trace ids are blocked at every boundary', () => {
  it('exact audit reproduction: scheme credentials in identity headers never reach headers, bodies or logs', async () => {
    const harness = await buildE2EApp();
    const res = await harness.inject({
      method: 'GET',
      url: '/api/v1/report25/ok',
      headers: {
        'x-correlation-id': `bearer ${LOWER_BEARER}`,
        'x-trace-id': `basic ${SHORT_BASIC}`,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['x-correlation-id'])).toBe(REDACTED_VALUE);
    expect(String(res.headers['x-trace-id'])).toBe(REDACTED_VALUE);
    expect(String(res.headers['x-correlation-id'])).not.toContain(LOWER_BEARER);
    expect(String(res.headers['x-trace-id'])).not.toContain(SHORT_BASIC);
    expect(res.body).not.toContain(LOWER_BEARER);
    expect(res.body).not.toContain(SHORT_BASIC);
    // Structured request logs: neither the pino-http req.headers echo nor the
    // onResponse/customProps context may carry the raw values.
    expect(harness.logText()).not.toContain(LOWER_BEARER);
    expect(harness.logText()).not.toContain(SHORT_BASIC);
    expect(harness.logText()).toContain(REDACTED_VALUE);
  }, 15000);

  it('SERVICE_DRAINING 503 responses and headers stay clean with credential ids', async () => {
    const harness = await buildE2EApp({ draining: true });
    const res = await harness.inject({
      method: 'GET',
      url: '/api/v1/report25/ok',
      headers: {
        'x-correlation-id': `basic ${SHORT_BASIC}`,
        'x-trace-id': `bearer ${LOWER_BEARER}`,
      },
    });
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.code).toBe('SERVICE_DRAINING');
    expect(body.message).toBe('Service is shutting down');
    expect(String(body.correlationId)).not.toContain(SHORT_BASIC);
    expect(String(body.traceId)).not.toContain(LOWER_BEARER);
    expect(String(res.headers['x-correlation-id'])).not.toContain(SHORT_BASIC);
    expect(String(res.headers['x-trace-id'])).not.toContain(LOWER_BEARER);
    expect(harness.logText()).not.toContain(SHORT_BASIC);
    expect(harness.logText()).not.toContain(LOWER_BEARER);
    // Availability semantics preserved: start was attempted, finish was not called.
    expect(harness.tracker.started).toBe(1);
    expect(harness.tracker.finished).toBe(0);
  }, 15000);
});

describe('report 25 — exception boundaries stay clean end-to-end', () => {
  it('5xx: the credential in the exception message is redacted in body, logs and logger context', async () => {
    const harness = await buildE2EApp();
    const res = await harness.inject({ method: 'GET', url: '/api/v1/report25/boom' });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.message).toBe('Internal server error');
    expect(res.body).not.toContain(LOWER_BEARER);
    expect(harness.logText()).not.toContain(LOWER_BEARER);
    const calls = harness.loggerCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload.errorMessage).toBe(`upstream auth failed: ${REDACTED_VALUE}`);
  }, 15000);

  it('4xx: the credential in the custom error field is redacted, message fidelity kept', async () => {
    const harness = await buildE2EApp();
    const res = await harness.inject({ method: 'GET', url: '/api/v1/report25/bad' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.message).toBe('bad input');
    expect(body.error).toBe(REDACTED_VALUE);
    expect(res.body).not.toContain(LOWER_BEARER);
    expect(harness.logText()).not.toContain(LOWER_BEARER);
  }, 15000);
});

describe('report 25 — URL-derived credential carriers never reach request logs', () => {
  it('a credential in the query string is absent from every structured request log', async () => {
    const harness = await buildE2EApp();
    const res = await harness.inject({
      method: 'GET',
      url: `/api/v1/report25/ok?access_token=${QUERY_SENTINEL}&keep=1`,
    });
    expect(res.statusCode).toBe(200);
    expect(harness.logText()).not.toContain(QUERY_SENTINEL);
    // The path portion keeps its diagnostic value.
    expect(harness.logText()).toContain('/api/v1/report25/ok');
  }, 15000);

  it('a percent-encoded credential in a route parameter is absent from every structured request log', async () => {
    const harness = await buildE2EApp();
    const res = await harness.inject({
      method: 'GET',
      url: `/api/v1/report25/item/bearer%20${LOWER_BEARER}`,
    });
    expect(res.statusCode).toBe(200);
    expect(harness.logText()).not.toContain(LOWER_BEARER);
    expect(harness.logText()).toContain('/api/v1/report25/item/');
  }, 15000);

  it('an unmatched route (404) never logs the raw-URL operationName fallback with its query', async () => {
    // The onResponse hook falls back to the raw request URL when no route
    // template matched; that fallback must pass through the shared
    // request-URL boundary (query excluded, decoded, redacted).
    const harness = await buildE2EApp();
    const res = await harness.inject({
      method: 'GET',
      url: `/api/v1/does-not-exist?access_token=${QUERY_SENTINEL}`,
    });
    expect(res.statusCode).toBe(404);
    expect(harness.logText()).not.toContain(QUERY_SENTINEL);
    expect(harness.logText()).toContain('request completed');
  }, 15000);

  it('a short-circuited draining response keeps every log line clean (context and operationName)', async () => {
    // The SERVICE_DRAINING reply short-circuits in onRequest. Fastify matches
    // the route BEFORE lifecycle hooks, so `routeOptions.url` remains defined
    // and the raw-URL operationName fallback is unreachable here (that sink is
    // pinned by the 404 test above); this test pins that the draining
    // lifecycle's hook log line — context spread included — stays clean end
    // to end.
    const harness = await buildE2EApp({ draining: true });
    const res = await harness.inject({
      method: 'GET',
      url: `/api/v1/report25/ok?access_token=${QUERY_SENTINEL}`,
    });
    expect(res.statusCode).toBe(503);
    expect(harness.logText()).toContain('request completed');
    expect(harness.logText()).not.toContain(QUERY_SENTINEL);
  }, 15000);
});

describe('report 25 — existing header redaction still holds (regression guard)', () => {
  it('the Authorization header value never appears in request logs', async () => {
    const harness = await buildE2EApp();
    const res = await harness.inject({
      method: 'GET',
      url: '/api/v1/report25/ok',
      headers: { authorization: `Bearer ${AUTH_SENTINEL}` },
    });
    expect(res.statusCode).toBe(200);
    expect(harness.logText()).not.toContain(AUTH_SENTINEL);
    expect(harness.logText()).toContain(REDACTED_VALUE);
  }, 15000);
});
