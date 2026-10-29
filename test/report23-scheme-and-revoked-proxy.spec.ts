import {
  BadRequestException,
  HttpException,
  type ArgumentsHost,
  type LoggerService,
} from '@nestjs/common';

import { REDACTED_VALUE, redactSensitiveText } from '../src/common/sensitive-data-redaction';
import { GlobalExceptionFilter } from '../src/http-exception.filter';

/**
 * Arena 4 report 23 (independent acceptance of 683fd40) — two residual findings, permanent
 * reproductions:
 *
 *  1. R-04 residual: valid short/lowercase scheme credentials evade the report-21 shape:
 *     `Basic dTpw` (4-char mixed-case token — bypassed the >=8 length floor) and
 *     `Bearer abcdefgh` (8-char all-lowercase token — bypassed the [A-Z0-9+/=_] marker
 *     requirement), plus newline-separated `Basic\ndTpw` / `Bearer\nabcdefgh`. They reached
 *     direct redaction, custom 4xx `error` fields, 5xx `errorMessage` logs and the
 *     client-controlled correlation/trace-id echo boundary.
 *  2. Exception-filter availability: a revoked Proxy used as an HttpException response's
 *     `message` array makes `sanitizeMessageValue()` throw at the UNGUARDED
 *     `Array.isArray(message)` check ("Cannot perform 'IsArray' on a proxy that has been
 *     revoked") before the guarded `.map()` path, so `catch()` throws before responding.
 */

const SHORT_BASIC = 'dTpw'; // base64('u:p') — valid short Basic credential, synthetic
const LOWER_BEARER = 'abcdefgh'; // valid lowercase b64token, synthetic

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
    id: 'req-report23-1',
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

describe('report 23 finding 1 — short/lowercase scheme credentials are redacted', () => {
  it('direct redaction: the exact short Basic credential (report-23 reproduction)', () => {
    expect(redactSensitiveText(`Basic ${SHORT_BASIC}`)).toBe(REDACTED_VALUE);
    const out = redactSensitiveText(`upstream said Basic ${SHORT_BASIC} today`);
    expect(out).not.toContain(SHORT_BASIC);
    expect(out).toContain('upstream said');
    expect(out).toContain(REDACTED_VALUE);
  });

  it('direct redaction: the exact lowercase Bearer token (report-23 reproduction)', () => {
    expect(redactSensitiveText(`Bearer ${LOWER_BEARER}`)).toBe(REDACTED_VALUE);
    const out = redactSensitiveText(`retry with Bearer ${LOWER_BEARER} failed`);
    expect(out).not.toContain(LOWER_BEARER);
    expect(out).toContain('retry with');
    expect(out).toContain('failed');
  });

  it('direct redaction: newline-separated scheme credentials (report-23 boundary)', () => {
    for (const input of [`Basic\n${SHORT_BASIC}`, `Bearer\n${LOWER_BEARER}`]) {
      const out = redactSensitiveText(input);
      expect(out).not.toContain(SHORT_BASIC);
      expect(out).not.toContain(LOWER_BEARER);
      expect(out).toContain(REDACTED_VALUE);
    }
  });

  it('scheme case variants of the short credentials are redacted', () => {
    for (const input of [
      `BASIC ${SHORT_BASIC}`,
      `BEARER ${LOWER_BEARER}`,
      `basic ${SHORT_BASIC}`, // marker-bearing token works under any scheme case
      `Basic\t${SHORT_BASIC}`,
      `Bearer   ${LOWER_BEARER}`,
    ]) {
      const out = redactSensitiveText(input);
      expect(out).not.toContain(SHORT_BASIC);
      expect(out).not.toContain(LOWER_BEARER);
      expect(out).toContain(REDACTED_VALUE);
    }
  });

  it('quoted, JSON-embedded and escaped-JSON variants are covered', () => {
    const quoted = redactSensitiveText(`got "Basic ${SHORT_BASIC}" from upstream`);
    expect(quoted).not.toContain(SHORT_BASIC);
    const json = redactSensitiveText(`{"h":"Basic ${SHORT_BASIC}"}`);
    expect(json).not.toContain(SHORT_BASIC);
    const parsed = JSON.parse(json) as { h: string };
    expect(parsed.h).toBe(REDACTED_VALUE);
    const escaped = redactSensitiveText(`{\\"h\\":\\"Bearer ${LOWER_BEARER}\\"}`);
    expect(escaped).not.toContain(LOWER_BEARER);
  });

  it('4xx: a custom error field carrying the short credential is sanitized (report-23 surface)', () => {
    const { response } = runFilterWith(
      new BadRequestException({ message: 'failed', error: `Basic ${SHORT_BASIC}` }),
    );
    expect(response.statusCode).toBe(400);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(SHORT_BASIC);
    expect(serialized).toContain(REDACTED_VALUE);
    expect(response.body.message).toBe('failed');
  });

  it('5xx: the short credential cannot reach the structured error log', () => {
    const { response, loggerCalls } = runFilterWith(
      new Error(`upstream returned Basic ${SHORT_BASIC}`),
    );
    expect(response.statusCode).toBe(500);
    const logged = JSON.stringify(loggerCalls[0]);
    expect(logged).not.toContain(SHORT_BASIC);
    expect(logged).toContain(REDACTED_VALUE);
  });

  it('client-controlled x-correlation-id / x-trace-id carrying short credentials are sanitized in body, headers and logs', () => {
    const { response, loggerCalls } = runFilterWith(new Error('boom'), {
      request: {
        headers: {
          'x-correlation-id': `Bearer ${LOWER_BEARER}`,
          'x-trace-id': `Basic ${SHORT_BASIC}`,
        },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(LOWER_BEARER);
    expect(JSON.stringify(response.body)).not.toContain(SHORT_BASIC);
    expect(JSON.stringify(loggerCalls[0])).not.toContain(LOWER_BEARER);
    expect(JSON.stringify(loggerCalls[0])).not.toContain(SHORT_BASIC);
    expect(response.headers['X-Correlation-Id']).not.toContain(LOWER_BEARER);
    expect(response.headers['X-Trace-Id']).not.toContain(SHORT_BASIC);
    expect(response.headers['X-Correlation-Id']).toContain(REDACTED_VALUE);
  });

  // SUPERSEDED BY REPORT 25 (documented policy change): this test originally pinned
  // the Branch B lowercase-prose exemption ('a basic understanding …' preserved). The
  // independent audit demonstrated that exemption is exactly the R-04 bypass
  // (`bearer abcdefgh` / `bearer abc` survived), and report 25 mandates preferring
  // explicit authentication credentials over ambiguous prose. Under the unified
  // case-insensitive scheme rule (no marker, no length floor) a scheme word followed
  // by whitespace and an ordinary word is conservatively redacted.
  it('report-25 policy: prose runs directly after a scheme word are conservatively redacted', () => {
    const prose1 = 'a basic understanding of the system is required';
    expect(redactSensitiveText(prose1)).toBe(`a ${REDACTED_VALUE} of the system is required`);
    const prose2 = 'the bearer of good news arrived';
    expect(redactSensitiveText(prose2)).toBe(`the ${REDACTED_VALUE} good news arrived`);
  });

  it('preservation: context-free tokens and Base64 without a scheme are untouched', () => {
    const bare1 = `decoded ${SHORT_BASIC} and ${LOWER_BEARER} fine`;
    expect(redactSensitiveText(bare1)).toBe(bare1);
    const bare2 = 'file content U29tZSBsb25nIHRleHQgaGVyZQ== decoded successfully';
    expect(redactSensitiveText(bare2)).toBe(bare2);
  });

  it('preservation: a scheme word followed by a colon is prose, not a credential', () => {
    const input = 'Basic: the fundamentals of mathematics';
    expect(redactSensitiveText(input)).toBe(input);
  });

  it('pinned caveat: a capitalized scheme word directly before an ordinary capitalized word redacts it (documented trade-off)', () => {
    expect(redactSensitiveText('Basic Authentication is disabled')).toBe(
      `${REDACTED_VALUE} is disabled`,
    );
  });
});

describe('report 23 finding 2 — revoked Proxies cannot abort the error response', () => {
  function revokedProxy(): unknown {
    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();
    return proxy;
  }

  function httpExceptionWithResponse(responseValue: unknown, status: number): HttpException {
    const exception = new HttpException('placeholder', status);
    Object.defineProperty(exception, 'getResponse', { value: () => responseValue });
    return exception;
  }

  it('a revoked Proxy as the message array still produces a valid fail-closed response (exact reproduction)', () => {
    const exception = httpExceptionWithResponse({ message: revokedProxy() }, 400);
    const { response } = runFilterWith(exception);
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe(REDACTED_VALUE);
    expect(response.body.error).toBe('BAD_REQUEST');
    expect(JSON.stringify(response.body)).not.toContain('revoked');
  });

  it('a revoked Proxy (object target) as the message value fails closed', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const { response } = runFilterWith(httpExceptionWithResponse({ message: proxy }, 400));
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe(REDACTED_VALUE);
  });

  it('a revoked Proxy nested inside a legitimate array degrades only that element', () => {
    const { response } = runFilterWith(
      httpExceptionWithResponse({ message: ['field required', revokedProxy()] }, 400),
    );
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toEqual(['field required', REDACTED_VALUE]);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('regression guard: legitimate validation arrays keep per-item fidelity', () => {
    const { response } = runFilterWith(
      httpExceptionWithResponse({ message: ['email must be valid', 'pin too short'] }, 400),
    );
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toEqual(['email must be valid', 'pin too short']);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('regression guard: a revoked Proxy exception value itself yields a canonical 500', () => {
    const { response, loggerCalls } = runFilterWith(revokedProxy());
    expect(response.statusCode).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    expect(loggerCalls[0]?.errorMessage).toBe(REDACTED_VALUE);
  });

  it('regression guard: ordinary exceptions keep full diagnostic fidelity', () => {
    const { response, loggerCalls } = runFilterWith(new Error('ordinary upstream failure'));
    expect(response.statusCode).toBe(500);
    expect(loggerCalls[0]?.errorMessage).toBe('ordinary upstream failure');
    const four = runFilterWith(new BadRequestException('field must be a positive number'));
    expect(four.response.statusCode).toBe(400);
    expect(four.response.body.message).toBe('field must be a positive number');
    expect(four.response.body.error).toBe('Bad Request');
  });
});
