import { BadRequestException, type ArgumentsHost, type LoggerService } from '@nestjs/common';

import {
  REDACTED_VALUE,
  redactSensitiveData,
  redactSensitiveText,
} from '../src/common/sensitive-data-redaction';
import { GlobalExceptionFilter } from '../src/http-exception.filter';

const PROVIDER_REF = 'pvr1:brevo:0123456789abcdef0123456789abcdef';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature';
const JWT_WITH_SEPARATORS = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.ABC_def-123';
const BASIC = 'dXNlcjpwYXNzd29yZA==';

function runFilter(exception: unknown): {
  response: { statusCode: number; body: Record<string, unknown> };
  loggerCalls: Array<Record<string, unknown>>;
} {
  let response: { statusCode: number; body: Record<string, unknown> } | undefined;
  const loggerCalls: Array<Record<string, unknown>> = [];
  const reply = {
    header: () => reply,
    status: (statusCode: number) => ({
      send: (body: Record<string, unknown>) => {
        response = { statusCode, body };
        return reply;
      },
    }),
  };
  const request = {
    id: 'report16-hardening',
    url: '/redaction-probe',
    method: 'POST',
    headers: {},
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => reply, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  const logger: LoggerService = {
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    error: jest.fn((record: Record<string, unknown>) => loggerCalls.push(record)),
  };

  new GlobalExceptionFilter(logger).catch(exception, host);
  if (!response) throw new Error('GlobalExceptionFilter did not send a response');
  return { response, loggerCalls };
}

describe('report-16 redaction hardening regressions', () => {
  describe('Authorization credentials', () => {
    const credentials = [
      `Authorization: Bearer ${JWT}`,
      `Authorization: Bearer ${JWT_WITH_SEPARATORS}`,
      `aUtHoRiZaTiOn = Basic ${BASIC}`,
      `Proxy-Authorization: Bearer ${JWT}`,
      `pRoXy-AuThOrIzAtIoN: Basic ${BASIC}`,
      `authorization: "Bearer ${JWT}"`,
      `Authorization: Bearer ${JWT}; Proxy-Authorization: Basic ${BASIC}`,
      `authorization=>Bearer ${JWT}; apiKey=UNRELATED_API_KEY_SECRET`,
    ];

    it.each(credentials)('redacts complete unquoted/quoted credential value: %s', (input) => {
      const output = redactSensitiveText(input);
      expect(output).not.toContain(JWT);
      expect(output).not.toContain(JWT_WITH_SEPARATORS);
      expect(output).not.toContain(BASIC);
      expect(output).not.toContain('UNRELATED_API_KEY_SECRET');
      expect(output).toContain(REDACTED_VALUE);
    });

    it('does not expose Authorization or Proxy-Authorization credentials in 4xx bodies or 5xx logs', () => {
      for (const value of credentials) {
        for (const exception of [new BadRequestException(value), new Error(value)]) {
          const result = runFilter(exception);
          const surfaces = [
            JSON.stringify(result.response.body),
            JSON.stringify(result.loggerCalls),
          ];
          for (const surface of surfaces) {
            expect(surface).not.toContain(JWT);
            expect(surface).not.toContain(JWT_WITH_SEPARATORS);
            expect(surface).not.toContain(BASIC);
            expect(surface).not.toContain('UNRELATED_API_KEY_SECRET');
          }
        }
      }
    });
  });

  describe('key-less provider-reference suffixes', () => {
    const suffixed = [
      `${PROVIDER_REF} ${JWT}`,
      `${PROVIDER_REF}\t${JWT}`,
      `${PROVIDER_REF}\n${JWT}`,
      `${PROVIDER_REF} ${JWT.replaceAll('.', '_')}`,
      `${PROVIDER_REF} ${JWT.replaceAll('.', '-')}`,
      `${PROVIDER_REF}\\${JWT}`,
    ];

    it.each(suffixed)(
      'redacts malformed provider reference with appended credential: %s',
      (input) => {
        const output = redactSensitiveText(input);
        expect(output).not.toContain(PROVIDER_REF);
        expect(output).not.toContain('eyJ');
        expect(output).toContain(REDACTED_VALUE);
      },
    );

    it('preserves a complete standalone canonical reference and ordinary prose', () => {
      expect(redactSensitiveText(PROVIDER_REF)).toBe(PROVIDER_REF);
      expect(redactSensitiveText(`reference ${PROVIDER_REF} already delivered`)).toBe(
        `reference ${PROVIDER_REF} already delivered`,
      );
    });

    it('redacts appended credential suffixes at 4xx and 5xx boundaries', () => {
      for (const suffix of suffixed) {
        for (const exception of [
          new BadRequestException(`Opaque reference ${suffix}`),
          new Error(`Opaque reference ${suffix}`),
        ]) {
          const result = runFilter(exception);
          const surfaces = [
            JSON.stringify(result.response.body),
            JSON.stringify(result.loggerCalls),
          ];
          for (const surface of surfaces) {
            expect(surface).not.toContain('eyJ');
            expect(surface).not.toContain(PROVIDER_REF);
          }
        }
      }
    });
  });

  describe('duplicate JSON property names', () => {
    const duplicated = [
      '{"apiKey":"DUPLICATE_API_SECRET","apiKey":null}',
      '{"apiKey":"DUPLICATE_API_SECRET","apiKey":"[REDACTED]"}',
      '{"api\\u004Bey":"DUPLICATE_API_SECRET","API_KEY":null}',
      '{"providerRef":"DUPLICATE_RAW_PROVIDER_SECRET","providerRef":"pvr1:brevo:0123456789abcdef0123456789abcdef"}',
      '{"authorization":"Bearer DUPLICATE_BEARER_SECRET","AUTHORIZATION":null}',
    ];

    it.each(duplicated)(
      'redacts every raw occurrence, including Unicode/case variants: %s',
      (input) => {
        const output = redactSensitiveText(input);
        expect(output).not.toMatch(/DUPLICATE_[A-Z_]+/);
        expect(() => {
          JSON.parse(output);
        }).not.toThrow();
      },
    );

    it('does not expose earlier duplicate values through 4xx or 5xx boundaries', () => {
      for (const input of duplicated) {
        for (const exception of [new BadRequestException(input), new Error(input)]) {
          const result = runFilter(exception);
          const surfaces = [
            JSON.stringify(result.response.body),
            JSON.stringify(result.loggerCalls),
          ];
          for (const surface of surfaces) expect(surface).not.toMatch(/DUPLICATE_[A-Z_]+/);
        }
      }
    });
  });

  describe('malformed, deeply nested, and bounded large inputs', () => {
    it('never throws from redaction or the global filter on 1,800 nested JSON arrays', () => {
      const deep = '['.repeat(1800) + '"safe"' + ']'.repeat(1800);
      expect(() => redactSensitiveText(deep)).not.toThrow();
      expect(() => runFilter(new BadRequestException(deep))).not.toThrow();
      expect(() => runFilter(new Error(deep))).not.toThrow();
    });

    it('fails closed on malformed structured text without returning a sensitive fragment', () => {
      const malformed = '{"apiKey":"MALFORMED_JSON_SECRET';
      expect(() => redactSensitiveText(malformed)).not.toThrow();
      expect(redactSensitiveText(malformed)).not.toContain('MALFORMED_JSON_SECRET');
      expect(() => runFilter(new BadRequestException(malformed))).not.toThrow();
    });

    it('uses a generic bounded fallback above the total input budget', () => {
      const oversized = `{"message":"${'x'.repeat(256 * 1024)}","apiKey":"SIZE_LIMIT_SECRET"}`;
      const startedAt = Date.now();
      const output = redactSensitiveText(oversized);
      expect(Date.now() - startedAt).toBeLessThan(1000);
      expect(output).toBe(REDACTED_VALUE);
      expect(output).not.toContain('SIZE_LIMIT_SECRET');
    });

    it('bounds direct structured-object recursion as well as error-text recursion', () => {
      let deeplyNested: unknown = { apiKey: 'OBJECT_DEPTH_SECRET' };
      for (let index = 0; index < 1800; index += 1) deeplyNested = [deeplyNested];
      expect(() => redactSensitiveData(deeplyNested)).not.toThrow();
      expect(JSON.stringify(redactSensitiveData(deeplyNested))).not.toContain(
        'OBJECT_DEPTH_SECRET',
      );
    });

    it('redacts doubly stringified JSON without damaging either JSON layer', () => {
      const inner = JSON.stringify({ apiKey: 'DOUBLE_STRING_SECRET', keep: 'visible' });
      const outer = JSON.stringify(inner);
      const output = redactSensitiveText(outer);
      const decodedOuter = JSON.parse(output) as string;
      const decodedInner = JSON.parse(decodedOuter) as Record<string, unknown>;
      expect(decodedInner).toEqual({ apiKey: REDACTED_VALUE, keep: 'visible' });
    });
  });

  describe('ordinary diagnostics versus sensitive code-family values', () => {
    it('preserves diagnostic status/error codes and redacts explicitly sensitive code-family keys', () => {
      const diagnostic = 'The code: 400; statusCode=401; errorCode=BAD_REQUEST';
      expect(redactSensitiveText(diagnostic)).toBe(diagnostic);
      const sensitive =
        'codeHash=HASH_SECRET recoveryCode=RECOVERY_SECRET transferCode=TRANSFER_SECRET challengeHash=CHALLENGE_SECRET';
      const output = redactSensitiveText(sensitive);
      for (const marker of [
        'HASH_SECRET',
        'RECOVERY_SECRET',
        'TRANSFER_SECRET',
        'CHALLENGE_SECRET',
      ]) {
        expect(output).not.toContain(marker);
      }
      expect(redactSensitiveText('{"code":"OTP_SECRET_123456"}')).toBe(
        `{"code":"${REDACTED_VALUE}"}`,
      );
      expect(redactSensitiveText('code: 081246')).toBe(`code: ${REDACTED_VALUE}`);
      expect(redactSensitiveText('code: 400')).toBe('code: 400');
    });
  });
});
