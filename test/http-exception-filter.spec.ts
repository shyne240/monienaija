import { BadRequestException, type ArgumentsHost, type LoggerService } from '@nestjs/common';

import { REDACTED_VALUE } from '../src/common/sensitive-data-redaction';
import { GlobalExceptionFilter } from '../src/http-exception.filter';

/**
 * SPRINT1-F01 residual R-03 (Arena 4 final independent acceptance of 30c3445, report 13):
 * a value shaped `pvr1:<scope>:<32 hex>:<SENSITIVE SUFFIX>` used to be exempted in FULL by
 * the redactSensitiveText negative-lookahead (it only checked a valid token PREFIX), so the
 * suffix leaked through the global exception filter into 4xx response bodies and 5xx
 * structured logs. These are the PERMANENT regressions for the audit's temporary probe
 * (`test/f01-error-text-probe.tmp.spec.ts`): only a complete canonical token may bypass
 * redaction; malformed values must be redacted end-to-end.
 */
const VALID_TOKEN = 'pvr1:brevo:0123456789abcdef0123456789abcdef';
const MALICIOUS = `providerRef=${VALID_TOKEN}:F01_SUFFIX_SENTINEL_TX_NGN_999000`;

interface CapturedResponse {
  statusCode: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function runFilter(exception: unknown): {
  response: CapturedResponse;
  loggerCalls: Array<Record<string, unknown>>;
} {
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
    id: 'req-r03-1',
    url: '/api/v1/internal/notifications/test-send',
    method: 'POST',
    headers: {},
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

describe('GlobalExceptionFilter — provider-reference error-text redaction (F-01/R-03)', () => {
  it('4xx: a malformed pvr1-prefixed value with a sensitive suffix is fully redacted from the response body', () => {
    const { response } = runFilter(new BadRequestException(`Invalid delivery ref ${MALICIOUS}`));
    expect(response.statusCode).toBe(400);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('F01_SUFFIX_SENTINEL_TX_NGN_999000');
    expect(serialized).not.toContain('TX_NGN_999000');
    // The complete malformed value is replaced — not merely its suffix.
    expect(response.body.message).toBe(`Invalid delivery ref providerRef=${REDACTED_VALUE}`);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('4xx: JSON-quoted malformed provider references are redacted without exposing the suffix', () => {
    const { response } = runFilter(
      new BadRequestException(`Payload rejected: {"providerRef":"${VALID_TOKEN}:F01_SUFFIX_SENTINEL_TX_NGN_999000"}`),
    );
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('F01_SUFFIX_SENTINEL_TX_NGN_999000');
    expect(response.body.message).toBe(`Payload rejected: {"providerRef":"${REDACTED_VALUE}"}`);
  });

  it('4xx: array (validation-style) messages are redacted item-by-item', () => {
    const exception = new BadRequestException({
      message: [`ref ${MALICIOUS}`, 'field must be a string'],
      error: 'Bad Request',
    });
    const { response } = runFilter(exception);
    const messages = response.body.message as string[];
    expect(Array.isArray(messages)).toBe(true);
    expect(messages[0]).toBe(`ref providerRef=${REDACTED_VALUE}`);
    expect(messages[1]).toBe('field must be a string');
    expect(JSON.stringify(response.body)).not.toContain('F01_SUFFIX_SENTINEL_TX_NGN_999000');
  });

  it('5xx: the structured error log and the client body cannot expose the malformed suffix', () => {
    const { response, loggerCalls } = runFilter(new Error(`Provider failure ${MALICIOUS}`));
    expect(response.statusCode).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    expect(JSON.stringify(response.body)).not.toContain('F01_SUFFIX_SENTINEL_TX_NGN_999000');
    expect(loggerCalls).toHaveLength(1);
    const logged = loggerCalls[0] as { errorMessage: string };
    expect(logged.errorMessage).toBe(`Provider failure providerRef=${REDACTED_VALUE}`);
    expect(logged.errorMessage).not.toContain('F01_SUFFIX_SENTINEL_TX_NGN_999000');
    expect(JSON.stringify(logged)).not.toContain('F01_SUFFIX_SENTINEL_TX_NGN_999000');
  });

  it('4xx: a legitimate exact canonical pvr1 token is preserved unchanged', () => {
    const { response } = runFilter(
      new BadRequestException(`Delivery already recorded providerRef=${VALID_TOKEN}`),
    );
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe(`Delivery already recorded providerRef=${VALID_TOKEN}`);
  });

  it('5xx: a legitimate exact canonical pvr1 token in the logged error is preserved unchanged', () => {
    const { loggerCalls } = runFilter(new Error(`Delivery already recorded providerRef=${VALID_TOKEN}`));
    expect(loggerCalls).toHaveLength(1);
    expect((loggerCalls[0] as { errorMessage: string }).errorMessage).toBe(
      `Delivery already recorded providerRef=${VALID_TOKEN}`,
    );
  });
});

/**
 * R-03 (report 14) whitespace/newline suffixes and R-04 JSON-quoted sensitive keys at the
 * actual HTTP error boundary: 4xx response bodies, 5xx structured logs and validation arrays.
 */
describe('GlobalExceptionFilter — R-03 whitespace suffix + R-04 JSON-quoted keys (report 14)', () => {
  const VALID_TOKEN = 'pvr1:brevo:fedcba9876543210fedcba9876543210';
  const REPORT_PROBE = `providerRef=${VALID_TOKEN} SPACE_SUFFIX_SENTINEL_TX_NGN_998000; {"apiKey":"JSON_KEY_SENTINEL_123"}`;

  it('4xx: the exact report-14 probe is fully redacted from the response body', () => {
    const { response } = runFilter(new BadRequestException(REPORT_PROBE));
    expect(response.statusCode).toBe(400);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('SPACE_SUFFIX_SENTINEL_TX_NGN_998000');
    expect(serialized).not.toContain('JSON_KEY_SENTINEL_123');
    expect(serialized).not.toContain('TX_NGN_998000');
    expect(response.body.message).toBe(`providerRef=${REDACTED_VALUE}; {"apiKey":"${REDACTED_VALUE}"}`);
  });

  it('5xx: the exact report-14 probe cannot reach the structured error log', () => {
    const { response, loggerCalls } = runFilter(new Error(REPORT_PROBE));
    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('SPACE_SUFFIX_SENTINEL_TX_NGN_998000');
    expect(loggerCalls).toHaveLength(1);
    const logged = JSON.stringify(loggerCalls[0]);
    expect(logged).not.toContain('SPACE_SUFFIX_SENTINEL_TX_NGN_998000');
    expect(logged).not.toContain('JSON_KEY_SENTINEL_123');
    expect((loggerCalls[0] as { errorMessage: string }).errorMessage).toContain(REDACTED_VALUE);
  });

  it('4xx: JSON-quoted providerRef with an in-value whitespace/newline suffix is redacted parseably', () => {
    const quotedSpace = `{"providerRef":"${VALID_TOKEN} SENTINEL_JSON_SPACE_TX_NGN_999000"}`;
    const { response } = runFilter(new BadRequestException(`Payload rejected: ${quotedSpace}`));
    const message = String(response.body.message);
    expect(message).not.toContain('SENTINEL_JSON_SPACE_TX_NGN_999000');
    expect(message).toBe(`Payload rejected: {"providerRef":"${REDACTED_VALUE}"}`);
    expect(JSON.parse(message.replace('Payload rejected: ', ''))).toEqual({ providerRef: REDACTED_VALUE });

    const quotedNewline = `{"providerRef":"${VALID_TOKEN}\\nSENTINEL_ESC_NL_TX_NGN_777000"}`;
    const { response: respNl } = runFilter(new BadRequestException(quotedNewline));
    expect(JSON.stringify(respNl.body)).not.toContain('SENTINEL_ESC_NL_TX_NGN_777000');
  });

  it('4xx: validation-array items carrying whitespace-suffixed tokens and JSON secrets are redacted', () => {
    const exception = new BadRequestException({
      message: [
        `ref providerRef=${VALID_TOKEN} ARRAY_SPACE_SENTINEL_TX_NGN_995500`,
        '{"authorization":"Bearer ARRAY_AUTH_SENTINEL_996600"}',
        'field must be a string',
      ],
      error: 'Bad Request',
    });
    const { response } = runFilter(exception);
    const messages = response.body.message as string[];
    expect(messages[0]).not.toContain('ARRAY_SPACE_SENTINEL_TX_NGN_995500');
    expect(messages[0]).toBe(`ref providerRef=${REDACTED_VALUE}`);
    expect(messages[1]).not.toContain('ARRAY_AUTH_SENTINEL_996600');
    expect(messages[2]).toBe('field must be a string');
  });

  it('4xx/5xx: R-04 quoted secret keys (apiKey, authorization, secret, token) are redacted in body and log', () => {
    const payload = `{"apiKey":"K_SENTINEL_1","authorization":"A_SENTINEL_2","secret":"S_SENTINEL_3","token":"T_SENTINEL_4"}`;
    const four = runFilter(new BadRequestException(payload));
    expect(JSON.stringify(four.response.body)).not.toMatch(/K_SENTINEL_1|A_SENTINEL_2|S_SENTINEL_3|T_SENTINEL_4/);
    expect(JSON.parse(String(four.response.body.message))).toEqual({
      apiKey: REDACTED_VALUE,
      authorization: REDACTED_VALUE,
      secret: REDACTED_VALUE,
      token: REDACTED_VALUE,
    });
    const five = runFilter(new Error(payload));
    expect(JSON.stringify(five.loggerCalls[0])).not.toMatch(/K_SENTINEL_1|A_SENTINEL_2|S_SENTINEL_3|T_SENTINEL_4/);
  });

  it('preserves ordinary non-sensitive 4xx messages and legitimate tokens at hard boundaries', () => {
    const ordinary = runFilter(new BadRequestException('field is invalid'));
    expect(ordinary.response.body.message).toBe('field is invalid');
    const legitimate = runFilter(
      new BadRequestException(`Duplicate delivery providerRef=${VALID_TOKEN}, attempts=1`),
    );
    expect(legitimate.response.body.message).toBe(`Duplicate delivery providerRef=${VALID_TOKEN}, attempts=1`);
  });

  it('handles a hostile 200 KB error message without hanging or leaking the terminal sentinel', () => {
    const hostile = `apiKey=${'x'.repeat(200_000)}HOSTILE_END_SENTINEL_999 providerRef=${VALID_TOKEN} HOSTILE_SPACE_SENTINEL_998`;
    const started = Date.now();
    const { response, loggerCalls } = runFilter(new Error(hostile));
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(response.statusCode).toBe(500);
    const logged = JSON.stringify(loggerCalls[0]);
    expect(logged).not.toContain('HOSTILE_END_SENTINEL_999');
    expect(logged).not.toContain('HOSTILE_SPACE_SENTINEL_998');
  });
});
