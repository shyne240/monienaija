import { Writable } from 'node:stream';

import {
  Controller,
  Get,
  Module,
  NotFoundException,
  type ArgumentsHost,
  type LoggerService,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

import { GlobalExceptionFilter } from '../src/http-exception.filter';
import { buildPinoHttpOptions } from '../src/production/pino-config';
import { registerRequestContextHooks } from '../src/production/request-hooks';

/**
 * Arena 4 report 26 (independent acceptance of 2e364cd) — N-01, permanent reproductions:
 * Nest's unmatched-route handling throws `NotFoundException("Cannot <METHOD> <url>")`
 * with the RAW url including the query string (@nestjs/core routes-resolver). The global
 * filter's message sanitizer redacts only KNOWN credential keys (e.g. `access_token=`),
 * so arbitrary query parameters — and percent-encoded scheme credentials such as
 * `e=bearer%20abcdefgh` (encoded space defeats the literal-whitespace scheme rule) —
 * are reflected verbatim into the 404 JSON body. Audit-confirmed in a real in-memory
 * NestJS/Fastify lifecycle.
 *
 * Policy: a 404 (or any error) message must never echo the untrusted query string,
 * regardless of parameter names or URL encoding; the query-free message
 * (`Cannot GET /api/v1/no-such`) and the 404 status must be preserved, and the existing
 * Pino log protections (report 25) must remain green.
 *
 * All sentinels are synthetic.
 */

const SENTINEL_PLAIN = 'QSECRET_SENTINEL_R26';
const SENTINEL_OPAQUE = 'opaque-secret-987654321-r26';
const SENTINEL_ENCODED_BEARER = 'abcdefgh'; // synthetic lowercase b64token
const SENTINEL_KEYED = 'ACCESSSECRET_SENTINEL_R26';

@Controller('report26')
class Report26Controller {
  @Get('ok')
  ok(): Record<string, boolean> {
    return { ok: true };
  }
}

@Module({ controllers: [Report26Controller] })
class Report26Module {}

interface Harness {
  inject(options: {
    method: 'GET';
    url: string;
    headers?: Record<string, string>;
  }): Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }>;
  logText(): string;
}

const createdApps: NestFastifyApplication[] = [];

async function buildHarness(): Promise<Harness> {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding: string, callback: (error?: Error | null) => void) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const moduleRef = await Test.createTestingModule({ imports: [Report26Module] }).compile();
  const pinoOptions = buildPinoHttpOptions();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  createdApps.push(app);
  app.setGlobalPrefix('api/v1');
  const captureLogger: LoggerService = {
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    error: jest.fn(),
  };
  app.useGlobalFilters(new GlobalExceptionFilter(captureLogger));
  const http = app.getHttpAdapter().getInstance();
  const tracker = {
    start: () => true,
    finish: () => undefined,
  };
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
    inject: async (options) => {
      const res = await http.inject(options);
      return { statusCode: res.statusCode, body: res.body, headers: res.headers };
    },
    logText: () => chunks.join(''),
  };
}

afterEach(async () => {
  while (createdApps.length > 0) {
    const app = createdApps.pop();
    await app?.close();
  }
});

describe('report 26 N-01 — unmatched-route 404 bodies never reflect the query string', () => {
  it('exact audit reproduction: arbitrary parameter value is not echoed in the 404 message', async () => {
    const harness = await buildHarness();
    const res = await harness.inject({
      method: 'GET',
      url: `/api/v1/no-such?x=${SENTINEL_PLAIN}`,
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(String(body.message)).not.toContain(SENTINEL_PLAIN);
    expect(String(body.message)).not.toContain('?');
    expect(res.body).not.toContain(SENTINEL_PLAIN);
    // Useful query-free message and status preserved.
    expect(String(body.message)).toContain('Cannot GET /api/v1/no-such');
    expect(body.statusCode).toBe(404);
  }, 15000);

  it('exact audit reproduction: opaque secret in an unknown parameter is not echoed', async () => {
    const harness = await buildHarness();
    const res = await harness.inject({
      method: 'GET',
      url: `/api/v1/no-such?foo=${SENTINEL_OPAQUE}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(SENTINEL_OPAQUE);
    expect(res.body).not.toContain('foo=');
  }, 15000);

  it('exact audit reproduction: percent-encoded bearer credential is not echoed or recoverable', async () => {
    const harness = await buildHarness();
    const res = await harness.inject({
      method: 'GET',
      url: `/api/v1/no-such?e=bearer%20${SENTINEL_ENCODED_BEARER}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(SENTINEL_ENCODED_BEARER);
    expect(res.body).not.toContain('bearer%20');
    expect(res.body).not.toContain('e=');
  }, 15000);

  it('keyed access_token protection still holds (regression guard)', async () => {
    const harness = await buildHarness();
    const res = await harness.inject({
      method: 'GET',
      url: `/api/v1/no-such?access_token=${SENTINEL_KEYED}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(SENTINEL_KEYED);
  }, 15000);

  it('Pino request logs remain query-free for unmatched routes (report-25 guard)', async () => {
    const harness = await buildHarness();
    const res = await harness.inject({
      method: 'GET',
      url: `/api/v1/no-such?x=${SENTINEL_PLAIN}&e=bearer%20${SENTINEL_ENCODED_BEARER}`,
    });
    expect(res.statusCode).toBe(404);
    expect(harness.logText()).not.toContain(SENTINEL_PLAIN);
    expect(harness.logText()).not.toContain(SENTINEL_ENCODED_BEARER);
  }, 15000);

  it('matched routes and legitimate 404 diagnostics keep working', async () => {
    const harness = await buildHarness();
    const ok = await harness.inject({ method: 'GET', url: '/api/v1/report26/ok' });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body) as unknown).toEqual({ ok: true });
    const notFound = await harness.inject({ method: 'GET', url: '/api/v1/report26/missing' });
    expect(notFound.statusCode).toBe(404);
    const body = JSON.parse(notFound.body) as Record<string, unknown>;
    expect(String(body.message)).toContain('Cannot GET /api/v1/report26/missing');
  }, 15000);
});

describe('report 26 N-01 — filter unit boundary: URL-bearing messages are query-stripped', () => {
  interface CapturedResponse {
    statusCode: number;
    body: Record<string, unknown>;
  }

  function runFilter(exception: unknown): CapturedResponse {
    let captured: CapturedResponse | undefined;
    const reply = {
      header: () => reply,
      status(statusCode: number) {
        return {
          send(body: Record<string, unknown>) {
            captured = { statusCode, body };
            return reply;
          },
        };
      },
    };
    const request = { id: 'req-r26-1', url: '/api/v1/no-such', method: 'GET', headers: {} };
    const host = {
      switchToHttp: () => ({ getResponse: () => reply, getRequest: () => request }),
    } as unknown as ArgumentsHost;
    const logger: LoggerService = {
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      error: jest.fn(),
    };
    new GlobalExceptionFilter(logger).catch(exception, host);
    if (!captured) throw new Error('filter did not send a response');
    return captured;
  }

  it('a Cannot-message with an arbitrary query is stripped to the query-free path', () => {
    const { statusCode, body } = runFilter(
      new NotFoundException(`Cannot GET /api/v1/no-such?x=${SENTINEL_PLAIN}`),
    );
    expect(statusCode).toBe(404);
    expect(body.message).toBe('Cannot GET /api/v1/no-such');
  });

  it('absolute URLs in messages lose query and fragment', () => {
    const { body } = runFilter(
      new NotFoundException(
        `upstream https://partner.example/callback?token=${SENTINEL_KEYED}#frag refused`,
      ),
    );
    expect(String(body.message)).not.toContain(SENTINEL_KEYED);
    expect(String(body.message)).toContain('https://partner.example/callback');
    expect(String(body.message)).toContain('refused');
  });

  it('ordinary prose questions are not mangled by query stripping', () => {
    const { body } = runFilter(new NotFoundException('what is this? nothing matched'));
    expect(body.message).toBe('what is this? nothing matched');
  });

  it('messages already carrying credential text remain fully redacted', () => {
    const { body } = runFilter(
      new NotFoundException(`Cannot GET /api/v1/x?e=bearer%20${SENTINEL_ENCODED_BEARER}`),
    );
    expect(String(body.message)).not.toContain(SENTINEL_ENCODED_BEARER);
    expect(String(body.message)).not.toContain('?');
    expect(String(body.message)).toBe('Cannot GET /api/v1/x');
  });
});
