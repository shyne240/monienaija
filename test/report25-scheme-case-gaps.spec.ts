import { BadRequestException, type ArgumentsHost, type LoggerService } from '@nestjs/common';

import { REDACTED_VALUE, redactSensitiveText } from '../src/common/sensitive-data-redaction';
import { GlobalExceptionFilter } from '../src/http-exception.filter';
import { createRequestContext } from '../src/production/request-context';

/**
 * Arena 4 report 25 (independent final security acceptance of af486bc) — R-04 FAIL,
 * permanent reproductions (all credentials synthetic):
 *
 *  1. Sanitizer gaps: `bearer abcdefgh` / `bEaReR abcdefgh` survive because Branch A
 *     only matches canonical casing and Branch B requires a [A-Z0-9+/=_] marker;
 *     `Bearer abc`, `Bearer a`, `bearer abc`, `BEARER a` survive because both branches
 *     enforce a >=4-character floor while RFC 6750 b64token permits 1+ characters and
 *     HTTP auth schemes are case-insensitive (RFC 7235).
 *  2. Application-level bypass: `createRequestContext` returns client-controlled
 *     `x-correlation-id` / `x-trace-id` header values verbatim (printable ASCII <=255),
 *     and those raw values reach response headers (main.ts onRequest hook), the
 *     SERVICE_DRAINING 503 body, the onResponse request log and pino `customProps`.
 *     The executed audit probe put `bearer abcdefgh` / `bearer abc` verbatim into a 500
 *     body, X-Correlation-Id / X-Trace-Id headers and the logger error context.
 *
 * Policy (report 25 mandate): explicit authentication credentials outweigh ambiguous
 * prose — any case-insensitive `basic`/`bearer` scheme word followed by whitespace and
 * a run of at least one token character is redacted, with no casing/marker/length
 * discriminator. Context-free strings without a scheme prefix are never touched.
 */

const LOWER_BEARER = 'abcdefgh'; // valid lowercase b64token, synthetic
const SHORT_BASIC = 'dTpw'; // base64('u:p') — valid short Basic credential, synthetic

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

function runFilterWith(
  exception: unknown,
  options: { request?: HarnessRequest } = {},
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
    id: 'req-report25-1',
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
    error: jest.fn((payload: Record<string, unknown>) => {
      loggerCalls.push(payload);
    }),
  };
  new GlobalExceptionFilter(logger).catch(exception, host);
  if (!captured) throw new Error('filter did not send a response');
  return { response: captured, loggerCalls };
}

describe('report 25 finding 1 — case-insensitive scheme matching without length floor', () => {
  it('exact audit reproductions: non-canonical casing survives today and must be redacted', () => {
    // Audit-verified survivors of the report-23 shapes (all synthetic credentials).
    for (const input of ['bearer abcdefgh', 'bEaReR abcdefgh', 'bearer dTpw', 'BaSiC abcdefgh']) {
      expect(redactSensitiveText(input)).toBe(REDACTED_VALUE);
    }
  });

  it('exact audit reproductions: valid short credentials (1-3 chars) must be redacted', () => {
    // RFC 6750 b64token permits one-or-more characters; no length floor may apply
    // once an explicit scheme prefix is present.
    for (const input of [
      'Bearer abc',
      'Bearer a',
      'bearer abc',
      'BEARER a',
      'Basic a',
      'basic ab',
    ]) {
      expect(redactSensitiveText(input)).toBe(REDACTED_VALUE);
    }
  });

  it('lowercase scheme with all-lowercase marker-free token is redacted', () => {
    expect(redactSensitiveText('basic dtpw')).toBe(REDACTED_VALUE);
    const out = redactSensitiveText('retry with basic dtpw failed');
    expect(out).not.toContain('dtpw');
    expect(out).toContain('retry with');
    expect(out).toContain('failed');
    expect(out).toContain(REDACTED_VALUE);
  });

  it('tab/newline separated scheme credentials are redacted under any casing', () => {
    for (const input of ['bearer\tabcdefgh', 'BEARER\nabcdefgh', 'basic\tdTpw']) {
      const out = redactSensitiveText(input);
      expect(out).not.toContain(LOWER_BEARER);
      expect(out).not.toContain(SHORT_BASIC);
      expect(out).toContain(REDACTED_VALUE);
    }
  });

  it('multiple credentials in one string are all redacted', () => {
    const input = 'tried bearer AAA1 then basic BBB2 then Bearer CCC3 onward';
    const out = redactSensitiveText(input);
    expect(out).not.toContain('AAA1');
    expect(out).not.toContain('BBB2');
    expect(out).not.toContain('CCC3');
    expect(out).toContain('tried');
    expect(out).toContain('onward');
    expect(out.split(REDACTED_VALUE).length - 1).toBe(3);
  });

  it('credentials inside structured diagnostic fields are redacted without touching siblings', () => {
    const out = redactSensitiveText('{"auth":"bearer abcdefgh","note":"delivered"}');
    expect(out).not.toContain(LOWER_BEARER);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.auth).toBe(REDACTED_VALUE);
    expect(parsed.note).toBe('delivered');
  });

  it('free-text error prose carrying a lowercase credential is redacted', () => {
    const out = redactSensitiveText('upstream auth failed: bearer abcdefgh');
    expect(out).toBe(`upstream auth failed: ${REDACTED_VALUE}`);
  });

  it('policy preservation: colon-blocked prose, bare scheme words and context-free tokens survive', () => {
    const input = 'Basic: the fundamentals of mathematics';
    expect(redactSensitiveText(input)).toBe(input);
    expect(redactSensitiveText('tokenType: Bearer,')).toBe('tokenType: Bearer,');
    const bare = `decoded ${SHORT_BASIC} and ${LOWER_BEARER} fine`;
    expect(redactSensitiveText(bare)).toBe(bare);
  });
});

describe('report 25 finding 2 — client-controlled identifiers are sanitized at creation', () => {
  it('exact audit probe: canonical scheme credentials in correlation/trace headers', () => {
    const context = createRequestContext({
      'x-correlation-id': `Basic ${SHORT_BASIC}`,
      'x-trace-id': `Bearer ${LOWER_BEARER}`,
    });
    expect(context.correlationId).not.toContain(SHORT_BASIC);
    expect(context.traceId).not.toContain(LOWER_BEARER);
    expect(context.correlationId).toContain(REDACTED_VALUE);
    expect(context.traceId).toContain(REDACTED_VALUE);
  });

  it('exact audit probe: lowercase/short scheme credentials in correlation/trace headers', () => {
    const context = createRequestContext({
      'x-correlation-id': 'bearer abcdefgh',
      'x-trace-id': 'bearer abc',
    });
    expect(context.correlationId).not.toContain(LOWER_BEARER);
    expect(context.traceId).not.toMatch(/\babc\b/);
    expect(context.correlationId).toBe(REDACTED_VALUE);
    expect(context.traceId).toBe(REDACTED_VALUE);
  });

  it('x-request-id header and the request.id parameter are sanitized too', () => {
    const viaHeader = createRequestContext({ 'x-request-id': `basic ${SHORT_BASIC}` });
    expect(viaHeader.requestId).not.toContain(SHORT_BASIC);
    const viaParam = createRequestContext({}, `bearer ${LOWER_BEARER}`);
    expect(viaParam.requestId).not.toContain(LOWER_BEARER);
    expect(viaParam.correlationId).not.toContain(LOWER_BEARER);
  });

  it('legitimate correlation and traceability identifiers are preserved exactly', () => {
    const context = createRequestContext(
      {
        'x-request-id': 'req-report25-9',
        'x-correlation-id': 'corr-report25-42',
        'x-trace-id': 'trace-report25-7',
      },
      'req-fastify-1',
    );
    expect(context.requestId).toBe('req-fastify-1');
    expect(context.correlationId).toBe('corr-report25-42');
    expect(context.traceId).toBe('trace-report25-7');
  });

  it('W3C traceparent-derived trace ids remain untouched', () => {
    const context = createRequestContext({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    });
    expect(context.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
  });
});

describe('report 25 — filter boundary reproductions of the executed audit probe', () => {
  it('500: credential-bearing correlation/trace ids are clean in body, headers and log context', () => {
    const { response, loggerCalls } = runFilterWith(
      new Error('upstream auth failed: bearer abcdefgh'),
      {
        request: {
          headers: { 'x-correlation-id': 'bearer abcdefgh', 'x-trace-id': 'bearer abc' },
        },
      },
    );
    expect(response.statusCode).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    expect(response.body.correlationId).toBe(REDACTED_VALUE);
    expect(response.body.traceId).toBe(REDACTED_VALUE);
    expect(response.headers['X-Correlation-Id']).toBe(REDACTED_VALUE);
    expect(response.headers['X-Trace-Id']).toBe(REDACTED_VALUE);
    expect(JSON.stringify(response.body)).not.toContain(LOWER_BEARER);
    expect(loggerCalls[0]?.errorMessage).toBe(`upstream auth failed: ${REDACTED_VALUE}`);
    expect(loggerCalls[0]?.correlationId).toBe(REDACTED_VALUE);
    expect(JSON.stringify(loggerCalls[0] ?? {})).not.toContain(LOWER_BEARER);
  });

  it('400: a credential in the custom error field is redacted, message fidelity kept', () => {
    const { response } = runFilterWith(
      new BadRequestException({ message: 'bad input', error: 'bearer abcdefgh' }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe('bad input');
    expect(response.body.error).toBe(REDACTED_VALUE);
    expect(JSON.stringify(response.body)).not.toContain(LOWER_BEARER);
  });
});
