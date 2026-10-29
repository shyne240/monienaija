import {
  BadRequestException,
  HttpException,
  type ArgumentsHost,
  type LoggerService,
} from '@nestjs/common';

import { REDACTED_VALUE, redactSensitiveText } from '../src/common/sensitive-data-redaction';
import { GlobalExceptionFilter } from '../src/http-exception.filter';

/**
 * Arena 4 report 21 (independent acceptance of 4ea7f1b) — two residual findings, permanent
 * reproductions:
 *
 *  1. R-04 residual: an explicit unkeyed `Basic <base64>` credential survived redaction in
 *     custom 4xx `error` fields, 5xx error logs and client-controlled correlation ids. The
 *     `Basic` scheme prefix supplies credential context; the complete credential must go.
 *  2. Exception-filter availability: `GlobalExceptionFilter.catch()` threw before sending a
 *     response for (a) a Proxy exception with a throwing `getPrototypeOf` trap (reached via
 *     the unguarded `instanceof HttpException`) and (b) an HttpException whose response
 *     object had a throwing `error` getter (reached via the unguarded `details.error` read;
 *     `details.message` shares the pattern).
 */

const BASIC_CREDENTIAL = 'dXNlcjpwYXNzd29yZA=='; // base64('user:password') — synthetic
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature';

interface CapturedResponse {
  statusCode: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

interface HarnessRequest {
  id?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}

interface HarnessOptions {
  request?: HarnessRequest;
  loggerError?: (payload: Record<string, unknown>) => void;
}

function runFilterWith(
  exception: unknown,
  options: HarnessOptions = {},
): { response: CapturedResponse; loggerCalls: Array<Record<string, unknown>> } {
  const headers: Record<string, string> = {};
  let captured: CapturedResponse | undefined;
  const reply = {
    header(name: string, value: string) {
      headers[name] = value;
      return reply;
    },
    status(statusCode: number) {
      return {
        send(body: Record<string, unknown>) {
          captured = { statusCode, body, headers };
          return reply;
        },
      };
    },
  };
  const request = {
    id: 'req-report21-1',
    url: '/api/v1/internal/notifications/test-send',
    method: 'POST',
    headers: {},
    ...options.request,
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  const loggerCalls: Array<Record<string, unknown>> = [];
  const logger: LoggerService = {
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    error: jest.fn(
      options.loggerError ??
        ((payload: Record<string, unknown>) => {
          loggerCalls.push(payload);
        }),
    ),
  };
  new GlobalExceptionFilter(logger).catch(exception, host);
  if (!captured) throw new Error('filter did not send a response');
  return { response: captured, loggerCalls };
}

describe('report 21 finding 1 — explicit Basic-scheme credentials are redacted everywhere', () => {
  it('direct redaction: the report-21 credential (exact reproduction)', () => {
    const out = redactSensitiveText(`upstream returned Basic ${BASIC_CREDENTIAL}`);
    expect(out).not.toContain(BASIC_CREDENTIAL);
    expect(out).toContain(REDACTED_VALUE);
    expect(out).toContain('upstream returned');
  });

  it('4xx: a custom error field carrying the credential is sanitized (exact reproduction)', () => {
    const { response } = runFilterWith(
      new BadRequestException({ message: 'failed', error: `Basic ${BASIC_CREDENTIAL}` }),
    );
    expect(response.statusCode).toBe(400);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(BASIC_CREDENTIAL);
    expect(serialized).toContain(REDACTED_VALUE);
    expect(response.body.message).toBe('failed');
  });

  it('5xx: the credential cannot reach the structured error log (exact reproduction)', () => {
    const { response, loggerCalls } = runFilterWith(
      new Error(`upstream returned Basic ${BASIC_CREDENTIAL}`),
    );
    expect(response.statusCode).toBe(500);
    const logged = JSON.stringify(loggerCalls[0]);
    expect(logged).not.toContain(BASIC_CREDENTIAL);
    expect(logged).toContain(REDACTED_VALUE);
    expect(JSON.stringify(response.body)).not.toContain(BASIC_CREDENTIAL);
  });

  it('client-controlled x-correlation-id / x-trace-id carrying the credential are sanitized in body, headers and logs', () => {
    const { response, loggerCalls } = runFilterWith(new Error('boom'), {
      request: {
        headers: {
          'x-correlation-id': `Basic ${BASIC_CREDENTIAL}`,
          'x-trace-id': `basic ${BASIC_CREDENTIAL}`,
        },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(BASIC_CREDENTIAL);
    expect(JSON.stringify(loggerCalls[0])).not.toContain(BASIC_CREDENTIAL);
    expect(response.headers['X-Correlation-Id']).not.toContain(BASIC_CREDENTIAL);
    expect(response.headers['X-Trace-Id']).not.toContain(BASIC_CREDENTIAL);
    expect(response.headers['X-Correlation-Id']).toContain(REDACTED_VALUE);
  });

  it('scheme names are case-insensitive', () => {
    for (const scheme of ['BASIC', 'basic', 'BaSiC', 'BASIC']) {
      const out = redactSensitiveText(`got ${scheme} ${BASIC_CREDENTIAL} from upstream`);
      expect(out).not.toContain(BASIC_CREDENTIAL);
    }
  });

  it('whitespace variations between scheme and credential are covered', () => {
    for (const gap of ['   ', '\t', ' \t ']) {
      const out = redactSensitiveText(`Basic${gap}${BASIC_CREDENTIAL}`);
      expect(out).not.toContain(BASIC_CREDENTIAL);
    }
  });

  it('quoted and JSON string values are covered', () => {
    const quoted = redactSensitiveText(`got "Basic ${BASIC_CREDENTIAL}" from upstream`);
    expect(quoted).not.toContain(BASIC_CREDENTIAL);
    const json = redactSensitiveText(`{"note":"Basic ${BASIC_CREDENTIAL}"}`);
    expect(json).not.toContain(BASIC_CREDENTIAL);
    const parsed = JSON.parse(json) as { note: string };
    expect(parsed.note).toBe(REDACTED_VALUE);
    const escaped = redactSensitiveText(`{\\"note\\":\\"Basic ${BASIC_CREDENTIAL}\\"}`);
    expect(escaped).not.toContain(BASIC_CREDENTIAL);
  });

  it('multiple credentials in one message are all removed', () => {
    const out = redactSensitiveText('Basic Zm9vOmJhcg== then basic YmFyOmZvbz== done');
    expect(out).not.toContain('Zm9vOmJhcg');
    expect(out).not.toContain('YmFyOmZvbz');
    expect(out).toContain('done');
  });

  it('mixed Bearer/Basic values in one message are all removed', () => {
    const out = redactSensitiveText(`A Basic ${BASIC_CREDENTIAL} B Bearer ${JWT} C`);
    expect(out).not.toContain(BASIC_CREDENTIAL);
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).not.toContain('signature');
  });

  it('malformed Base64 after the scheme is still removed (fail-closed)', () => {
    for (const variant of [
      `Basic dXNlc!pwYXNzd29yZA==`,
      `Basic dXNlcjpwYXNzd29yZA`, // unpadded
      `Basic %%%not-base64-at-all%%%`,
    ]) {
      const out = redactSensitiveText(`credential ${variant} leaked`);
      expect(out).not.toContain('pwYXNzd29yZA');
      expect(out).not.toContain('not-base64-at-all');
      expect(out).toContain('leaked');
    }
  });

  it('ordinary Base64 without credential context is preserved', () => {
    const input = 'file content U29tZSBsb25nIHRleHQgaGVyZQ== decoded successfully';
    expect(redactSensitiveText(input)).toBe(input);
  });

  it('ordinary prose around the scheme word is preserved', () => {
    const input = 'a basic understanding of the system is required';
    expect(redactSensitiveText(input)).toBe(input);
    const input2 = 'the bearer of good news arrived';
    expect(redactSensitiveText(input2)).toBe(input2);
  });
});

describe('report 21 finding 2 — hostile objects cannot make the filter throw before responding', () => {
  it('a Proxy exception with a throwing getPrototypeOf trap still produces a canonical 500 (exact reproduction)', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('proxy getPrototypeOf');
        },
      },
    );
    const { response, loggerCalls } = runFilterWith(hostile);
    expect(response.statusCode).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    expect(response.body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('proxy getPrototypeOf');
    expect(JSON.stringify(loggerCalls[0])).not.toContain('proxy getPrototypeOf');
  });

  it('an HttpException response Proxy with a throwing error getter keeps status and message, fails the error field closed (exact reproduction)', () => {
    const proxyResponse = new Proxy(
      { message: 'safe' },
      {
        get(target, key, receiver) {
          if (key === 'error') throw new Error('error getter trap');
          return Reflect.get(target, key, receiver) as unknown;
        },
      },
    );
    const exception = new HttpException(proxyResponse, 400);
    const { response } = runFilterWith(exception);
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe('safe');
    expect(response.body.error).toBe('BAD_REQUEST');
    expect(JSON.stringify(response.body)).not.toContain('error getter trap');
  });

  it('a throwing message getter falls back to the canonical request-failed message', () => {
    const proxyResponse = new Proxy(
      { error: 'static-label' },
      {
        get(target, key, receiver) {
          if (key === 'message') throw new Error('message getter trap');
          return Reflect.get(target, key, receiver) as unknown;
        },
      },
    );
    // Nest's HttpException constructor itself reads response.message (initMessage), so the
    // hostile response object is installed after construction to reach the filter boundary.
    const exception = new HttpException({ message: 'placeholder' }, 400);
    Object.defineProperty(exception, 'getResponse', { value: () => proxyResponse });
    const { response } = runFilterWith(exception);
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe('Request failed');
    expect(response.body.error).toBe('static-label');
  });

  it('a throwing getStatus trap degrades to a canonical 500', () => {
    const hostile = new Proxy(new BadRequestException('inner'), {
      get(target, key) {
        if (key === 'getStatus') {
          return () => {
            throw new Error('getStatus trap');
          };
        }
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    const { response } = runFilterWith(hostile);
    expect(response.statusCode).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    expect(JSON.stringify(response.body)).not.toContain('getStatus trap');
  });

  it('a throwing message accessor on an Error-like exception yields the generic log message', () => {
    const exception = new Error('placeholder');
    Object.defineProperty(exception, 'message', {
      get() {
        throw new Error('message accessor trap');
      },
    });
    const { response, loggerCalls } = runFilterWith(exception);
    expect(response.statusCode).toBe(500);
    expect(loggerCalls[0]?.errorMessage).toBe(REDACTED_VALUE);
    expect(JSON.stringify(loggerCalls[0])).not.toContain('message accessor trap');
  });

  it('a hostile validation-message array fails closed to the generic redaction', () => {
    const hostileArray = new Proxy(['safe-item'], {
      get(target, key) {
        if (key === '0') throw new Error('element trap');
        return Reflect.get(target, key) as unknown;
      },
    });
    const { response } = runFilterWith(
      new HttpException({ message: hostileArray } as never, 400),
    );
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe(REDACTED_VALUE);
    expect(JSON.stringify(response.body)).not.toContain('element trap');
    expect(JSON.stringify(response.body)).not.toContain('safe-item');
  });

  it('a throwing logger.error cannot prevent the response', () => {
    const { response } = runFilterWith(new Error('boom'), {
      loggerError: () => {
        throw new Error('logger trap');
      },
    });
    expect(response.statusCode).toBe(500);
    expect(response.body.message).toBe('Internal server error');
  });

  it('regression guard: ordinary exceptions keep full diagnostic fidelity', () => {
    const { response, loggerCalls } = runFilterWith(new Error('ordinary upstream failure'));
    expect(response.statusCode).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    expect(loggerCalls[0]?.errorMessage).toBe('ordinary upstream failure');
    const four = runFilterWith(new BadRequestException('field must be a positive number'));
    expect(four.response.statusCode).toBe(400);
    expect(four.response.body.message).toBe('field must be a positive number');
    expect(four.response.body.error).toBe('Bad Request');
  });
});
