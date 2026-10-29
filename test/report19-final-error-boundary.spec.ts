import { BadRequestException, type ArgumentsHost, type LoggerService } from '@nestjs/common';

import { REDACTED_VALUE } from '../src/common/sensitive-data-redaction';
import { redactSensitiveText } from '../src/common/sensitive-data-redaction';
import { GlobalExceptionFilter } from '../src/http-exception.filter';

/**
 * Arena 4 report 19 (final independent acceptance of b303a49) — three disclosure findings,
 * permanent reproductions:
 *
 *  A. R-03 residual: a canonical `pvr1:` reference with an ATTACHED ordinary fragment followed
 *     by a whitespace-separated JWT leaked the JWT (suffix scanner stopped at the attachment;
 *     the shape pattern consumed only token+attachment).
 *  B. R-04 boundary: `GlobalExceptionFilter` copied a custom HttpException response's `error`
 *     field into the 4xx body without redaction.
 *  C. R-04 boundary: the filter copied `request.url` (including query strings) into the
 *     response `path` field and the 5xx structured log without redaction.
 *
 * Plus the §2 boundary audit instance: client-controlled request-context ids
 * (`x-request-id` / `x-correlation-id` / `x-trace-id`) echoed unsanitized into response
 * headers, body fields and the 5xx log spread, and a hostile `toString()` exception that
 * must not crash the filter.
 */

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature';
const REPORT19_INPUT = `Opaque provider reference: pvr1:brevo:0123456789abcdef0123456789abcdefsuffix ${JWT}`;

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
  requestOverrides: HarnessRequest = {},
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
    id: 'req-report19-1',
    url: '/api/v1/internal/notifications/test-send',
    method: 'POST',
    headers: {},
    ...requestOverrides,
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

describe('report 19 finding A — attached-fragment provider reference followed by a JWT', () => {
  it('direct redaction removes the complete region (report-19 exact reproduction)', () => {
    expect(redactSensitiveText(REPORT19_INPUT)).toBe(`Opaque provider reference: ${REDACTED_VALUE}`);
  });

  it('direct redaction: newline-separated JWT after an attached fragment is consumed', () => {
    const input = `pvr1:brevo:0123456789abcdef0123456789abcdefsuffix\n${JWT}`;
    const out = redactSensitiveText(input);
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).not.toContain('signature');
    expect(out).toContain(REDACTED_VALUE);
  });

  it('direct redaction: long opaque credential after an attached fragment is consumed', () => {
    const opaque = 'a1B2c3D4e5F6a7B8c9D0e1F2a3B4c5D6e7F8a9B0';
    const out = redactSensitiveText(`ref pvr1:resend:0123456789abcdef0123456789abcdefmeta ${opaque}`);
    expect(out).not.toContain(opaque);
    expect(out).toContain(REDACTED_VALUE);
  });

  it('preservation guard: attached fragment plus ordinary prose destroys nothing extra', () => {
    const input = 'Opaque reference: pvr1:brevo:0123456789abcdef0123456789abcdefsuffix was delivered to the recipient';
    expect(redactSensitiveText(input)).toBe(
      `Opaque reference: ${REDACTED_VALUE} was delivered to the recipient`,
    );
  });

  it('4xx: the JWT cannot reach the response message', () => {
    const { response } = runFilterWith(new BadRequestException(REPORT19_INPUT));
    expect(response.statusCode).toBe(400);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(serialized).not.toContain('signature');
    expect(serialized).toContain(REDACTED_VALUE);
  });

  it('5xx: the JWT cannot reach the structured error log', () => {
    const { response, loggerCalls } = runFilterWith(new Error(REPORT19_INPUT));
    expect(response.statusCode).toBe(500);
    const logged = JSON.stringify(loggerCalls[0]);
    expect(logged).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(logged).not.toContain('signature');
    expect(logged).toContain(REDACTED_VALUE);
  });
});

describe('report 19 finding B — custom HTTP error field must pass the sanitization boundary', () => {
  it('4xx: details.error containing a sensitive key/value is redacted (exact reproduction)', () => {
    const { response } = runFilterWith(
      new BadRequestException({
        message: 'Ordinary validation failure',
        error: 'apiKey=ERROR_FIELD_SECRET_SENTINEL',
      }),
    );
    expect(response.statusCode).toBe(400);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('ERROR_FIELD_SECRET_SENTINEL');
    expect(serialized).toContain(REDACTED_VALUE);
    // legitimate diagnostics survive
    expect(response.body.message).toBe('Ordinary validation failure');
  });

  it('4xx: details.error containing a JWT is redacted', () => {
    const { response } = runFilterWith(
      new BadRequestException({ message: 'failed', error: `Bearer ${JWT}` }),
    );
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(serialized).not.toContain('signature');
  });

  it('4xx: a non-string details.error fails closed to the canonical code', () => {
    const { response } = runFilterWith(
      new BadRequestException({ message: 'failed', error: { nested: 'ERROR_OBJECT_SECRET_SENTINEL' } }),
    );
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('ERROR_OBJECT_SECRET_SENTINEL');
    expect(response.body.error).toBe('BAD_REQUEST');
  });

  it('4xx: Nest static error labels are preserved and absent fields fall back to the canonical code', () => {
    const labelled = runFilterWith(new BadRequestException('plain failure'));
    expect(labelled.response.body.error).toBe('Bad Request');
    const absent = runFilterWith(new BadRequestException({ message: 'field failure' }));
    expect(absent.response.body.error).toBe('BAD_REQUEST');
  });
});

describe('report 19 finding C — query strings must not reach diagnostic path fields', () => {
  it('5xx: query credential is absent from response path and structured log (exact reproduction)', () => {
    const { response, loggerCalls } = runFilterWith(new Error('boom'), {
      url: '/api/v1/lookup?access_token=PATH_QUERY_SECRET_SENTINEL',
    });
    expect(response.statusCode).toBe(500);
    expect(response.body.path).toBe('/api/v1/lookup');
    expect(JSON.stringify(response.body)).not.toContain('PATH_QUERY_SECRET_SENTINEL');
    expect(loggerCalls[0]?.path).toBe('/api/v1/lookup');
    expect(JSON.stringify(loggerCalls[0])).not.toContain('PATH_QUERY_SECRET_SENTINEL');
  });

  it('4xx: query credential is absent from the response path', () => {
    const { response } = runFilterWith(new BadRequestException('bad'), {
      url: '/api/v1/lookup?apiKey=PATH4XX_SECRET_SENTINEL',
    });
    expect(response.body.path).toBe('/api/v1/lookup');
    expect(JSON.stringify(response.body)).not.toContain('PATH4XX_SECRET_SENTINEL');
  });

  it('percent-encoded parameter names and values are excluded', () => {
    const { response } = runFilterWith(new BadRequestException('bad'), {
      url: '/api/v1/lookup?%61pi_key=PCT_ENC_SECRET_SENTINEL&x=%53ECRET',
    });
    expect(response.body.path).toBe('/api/v1/lookup');
    expect(JSON.stringify(response.body)).not.toContain('PCT_ENC_SECRET_SENTINEL');
  });

  it('repeated parameters are excluded', () => {
    const { response } = runFilterWith(new BadRequestException('bad'), {
      url: '/api/v1/lookup?a=1&token=REP_SECRET_SENTINEL&token=REP_SECRET_SENTINEL_2',
    });
    expect(response.body.path).toBe('/api/v1/lookup');
    expect(JSON.stringify(response.body)).not.toContain('REP_SECRET_SENTINEL');
  });

  it('mixed-case query keys are excluded', () => {
    const { response } = runFilterWith(new BadRequestException('bad'), {
      url: '/api/v1/lookup?API_KEY=MIXCASE_SECRET_SENTINEL',
    });
    expect(response.body.path).toBe('/api/v1/lookup');
    expect(JSON.stringify(response.body)).not.toContain('MIXCASE_SECRET_SENTINEL');
  });

  it('fragments terminate the diagnostic path', () => {
    const { response } = runFilterWith(new BadRequestException('bad'), {
      url: '/api/v1/lookup#frag?x=FRAG_SECRET_SENTINEL',
    });
    expect(response.body.path).toBe('/api/v1/lookup');
    expect(JSON.stringify(response.body)).not.toContain('FRAG_SECRET_SENTINEL');
  });

  it('malformed URL strings never throw and never carry the query', () => {
    const { response } = runFilterWith(new BadRequestException('bad'), {
      url: 'not a url at all?apiKey=MALFORMED_SECRET_SENTINEL',
    });
    expect(response.body.path).toBe('not a url at all');
    expect(JSON.stringify(response.body)).not.toContain('MALFORMED_SECRET_SENTINEL');
  });

  it('query-free URLs are preserved exactly', () => {
    const { response } = runFilterWith(new BadRequestException('bad'), {
      url: '/api/v1/internal/notifications/test-send',
    });
    expect(response.body.path).toBe('/api/v1/internal/notifications/test-send');
  });

  it('a sensitive key/value inside the path segment is still sanitized', () => {
    const { response } = runFilterWith(new BadRequestException('bad'), {
      url: '/api/v1/lookup/apiKey=PATH_SEG_SECRET_SENTINEL',
    });
    expect(JSON.stringify(response.body)).not.toContain('PATH_SEG_SECRET_SENTINEL');
    expect(response.body.path).toBe(`/api/v1/lookup/apiKey=${REDACTED_VALUE}`);
  });
});

describe('report 19 §2 boundary audit — client-controlled context ids and hostile exceptions', () => {
  it('sensitive values in x-request-id/x-correlation-id/x-trace-id cannot reach body, headers or logs', () => {
    const { response, loggerCalls } = runFilterWith(new Error('boom'), {
      headers: {
        'x-request-id': 'apiKey=REQID_SECRET_SENTINEL',
        'x-correlation-id': 'token=CORR_SECRET_SENTINEL',
        'x-trace-id': 'secret=TRACE_SECRET_SENTINEL',
      },
    });
    const serializedBody = JSON.stringify(response.body);
    const serializedLog = JSON.stringify(loggerCalls[0]);
    for (const sentinel of [
      'REQID_SECRET_SENTINEL',
      'CORR_SECRET_SENTINEL',
      'TRACE_SECRET_SENTINEL',
    ]) {
      expect(serializedBody).not.toContain(sentinel);
      expect(serializedLog).not.toContain(sentinel);
    }
    expect(response.headers['X-Request-Id']).not.toContain('REQID_SECRET_SENTINEL');
    expect(response.headers['X-Correlation-Id']).not.toContain('CORR_SECRET_SENTINEL');
    expect(response.headers['X-Trace-Id']).not.toContain('TRACE_SECRET_SENTINEL');
  });

  it('ordinary client-provided ids are echoed unchanged', () => {
    const { response } = runFilterWith(new BadRequestException('bad'), {
      headers: { 'x-request-id': 'req-client-42', 'x-correlation-id': 'corr-client-42' },
    });
    // request.id (server-generated) wins for requestId; correlation id echoes the header.
    expect(response.body.requestId).toBe('req-report19-1');
    expect(response.body.correlationId).toBe('corr-client-42');
    expect(response.headers['X-Correlation-Id']).toBe('corr-client-42');
    expect(response.headers['X-Request-Id']).toBe('req-report19-1');
  });

  it('a hostile exception toString cannot crash the filter and yields the generic redaction', () => {
    const hostile = {
      toString() {
        throw new Error('hostile toString');
      },
    };
    const { response, loggerCalls } = runFilterWith(hostile);
    expect(response.statusCode).toBe(500);
    expect(loggerCalls[0]?.errorMessage).toBe(REDACTED_VALUE);
    expect(response.body.message).toBe('Internal server error');
  });
});
