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
describe('GlobalExceptionFilter — provider-reference error-text redaction (F-01/R-03)', () => {
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
