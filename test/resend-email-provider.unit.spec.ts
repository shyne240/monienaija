/* eslint-disable @typescript-eslint/require-await */
import type { NotificationSendRequest } from '../src/notification/notification.types';
import {
  SAFE_PROVIDER_REF_PATTERN,
  deriveSafeVendorProviderRef,
} from '../src/notification/provider-security';
import { ResendEmailProvider, sanitizeHeader } from '../src/notification/resend-email-provider';
import { validateEnvironment } from '../src/config/environment';

/**
 * ARENA3-NOTIFICATION-EMAIL — Resend adapter contract unit tests (no network, no DB).
 * Mirrors the RobaseNotificationProvider spec discipline exactly: the fetch dependency is
 * mocked; assertions cover the documented HTTP contract (POST {base}/emails, Bearer re_*
 * auth, Idempotency-Key header, {from,to,subject,text,html?,reply_to?} body, {id} success
 * payload), stable bounded error codes, credential hygiene (the API key never appears in
 * results/errors), destination/subject validation, timeouts and channel routing.
 */

const API_KEY = 're_' + 'a'.repeat(64);

function request(overrides: Partial<NotificationSendRequest> = {}): NotificationSendRequest {
  return {
    channel: 'EMAIL',
    destination: 'customer@example.com',
    message: 'Transfer NGN 250.00 completed. Ref 4d2c1d01.',
    payload: {},
    correlationId: 'corr-1',
    eventType: 'transfer.completed',
    eventKey: 'transfer.completed:tx-1:2026-10-27',
    recipientType: 'CUSTOMER',
    recipientId: '11111111-1111-4111-8111-111111111111',
    subject: 'Transfer received',
    html: '<html><body><p>Transfer NGN 250.00 completed.</p></body></html>',
    ...overrides,
  };
}

type MockFetchInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

describe('ResendEmailProvider (documented contract, mocked transport)', () => {
  it('1. successful send → success + providerRef; verified request shape', async () => {
    const calls: Array<{ url: string; init: MockFetchInit }> = [];
    const provider = new ResendEmailProvider(
      {
        baseUrl: 'https://api.resend.com',
        apiKey: API_KEY,
        from: 'MonieNaija <notifications@monienaija.ng>',
        replyTo: 'support@monienaija.ng',
        requestTimeoutMs: 5000,
      },
      async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ id: '49a3999c-0ce1-4ea6-a689-9f01dcb1a646' }) };
      },
    );

    const result = await provider.send(request());

    expect(result.success).toBe(true);
    expect(result.providerRef).toMatch(SAFE_PROVIDER_REF_PATTERN);
    expect(result.providerRef).toBe(
      deriveSafeVendorProviderRef('resend', '49a3999c-0ce1-4ea6-a689-9f01dcb1a646', API_KEY),
    );
    expect(result.providerRef).not.toContain('49a3999c');
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls[0]!.init.headers['Content-Type']).toBe('application/json');
    expect(calls[0]!.init.headers['Idempotency-Key']).toBe(
      `transfer.completed:tx-1:2026-10-27:11111111-1111-4111-8111-111111111111:EMAIL`,
    );
    const body = JSON.parse(calls[0]!.init.body) as Record<string, unknown>;
    expect(body.from).toBe('MonieNaija <notifications@monienaija.ng>');
    expect(body.to).toEqual(['customer@example.com']);
    expect(body.subject).toBe('Transfer received');
    expect(body.text).toContain('NGN 250.00');
    expect(body.html).toContain('<p>Transfer NGN 250.00 completed.</p>');
    expect(body.reply_to).toBe('support@monienaija.ng');
  });

  it('2. omits html/reply_to when not provided; destination is trimmed + lowercased', async () => {
    const calls: Array<{ init: MockFetchInit }> = [];
    const provider = new ResendEmailProvider(
      { baseUrl: 'https://api.resend.com', apiKey: API_KEY, from: 'noreply@monienaija.ng', requestTimeoutMs: 5000 },
      async (_url, init) => {
        calls.push({ init });
        return { ok: true, status: 200, json: async () => ({ id: 'msg-2' }) };
      },
    );

    const result = await provider.send(
      request({ destination: '  Customer@Example.COM ', html: undefined }),
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(calls[0]!.init.body) as Record<string, unknown>;
    expect(body.to).toEqual(['customer@example.com']);
    expect(body.html).toBeUndefined();
    expect(body.reply_to).toBeUndefined();
  });

  it('3. non-2xx with a stable error name → RESEND_HTTP_<status>:<name> only (no prose)', async () => {
    const provider = new ResendEmailProvider(
      { baseUrl: 'https://api.resend.com', apiKey: API_KEY, from: 'noreply@monienaija.ng', requestTimeoutMs: 5000 },
      async () => ({
        ok: false,
        status: 422,
        json: async () => ({
          name: 'validation_error',
          message: 'some verbose provider prose that must never surface re_7f3k9',
        }),
      }),
    );

    const result = await provider.send(request());

    expect(result.success).toBe(false);
    expect(result.error).toBe('RESEND_HTTP_422:validation_error');
    expect(result.error).not.toContain('prose');
    expect(result.error).not.toContain(API_KEY);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it('4. non-JSON / unrecognized error envelope → generic bounded code, never throws', async () => {
    const provider = new ResendEmailProvider(
      { baseUrl: 'https://api.resend.com', apiKey: API_KEY, from: 'noreply@monienaija.ng', requestTimeoutMs: 5000 },
      async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      }),
    );

    const result = await provider.send(request());
    expect(result).toEqual({ success: false, error: 'RESEND_HTTP_500:unknown' });
  });

  it('5. unstable characters in error names are rejected (bounded code only)', async () => {
    const provider = new ResendEmailProvider(
      { baseUrl: 'https://api.resend.com', apiKey: API_KEY, from: 'noreply@monienaija.ng', requestTimeoutMs: 5000 },
      async () => ({
        ok: false,
        status: 429,
        json: async () => ({ name: 'rate limit exceeded — key re_secret leaked?' }),
      }),
    );

    const result = await provider.send(request());
    expect(result.error).toBe('RESEND_HTTP_429:unknown');
  });

  it('6. timeout (AbortError) → RESEND_TIMEOUT', async () => {
    const provider = new ResendEmailProvider(
      { baseUrl: 'https://api.resend.com', apiKey: API_KEY, from: 'noreply@monienaija.ng', requestTimeoutMs: 50 },
      async () => {
        const abort = new Error('This operation was aborted');
        abort.name = 'AbortError';
        throw abort;
      },
    );

    const result = await provider.send(request());
    expect(result).toEqual({ success: false, error: 'RESEND_TIMEOUT' });
  });

  it('7. network failure → RESEND_NETWORK:<name> (error name only, no message)', async () => {
    const provider = new ResendEmailProvider(
      { baseUrl: 'https://api.resend.com', apiKey: API_KEY, from: 'noreply@monienaija.ng', requestTimeoutMs: 5000 },
      async () => {
        throw new TypeError('fetch failed resolving host with secret re_key in query');
      },
    );

    const result = await provider.send(request());
    expect(result.success).toBe(false);
    expect(result.error).toBe('RESEND_NETWORK:TypeError');
  });

  it('8. invalid destinations are rejected locally without any network call', async () => {
    let fetchCalls = 0;
    const provider = new ResendEmailProvider(
      { baseUrl: 'https://api.resend.com', apiKey: API_KEY, from: 'noreply@monienaija.ng', requestTimeoutMs: 5000 },
      async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, json: async () => ({ id: 'x' }) };
      },
    );

    for (const bad of [
      'not-an-email',
      'two@addresses.com,third@addresses.com',
      'spaces in@example.com',
      'quoted"address@example.com',
      'a@b',
      `${'x'.repeat(250)}@example.com`,
      'header\r\ninjection@example.com',
    ]) {
      const result = await provider.send(request({ destination: bad }));
      expect(result.success).toBe(false);
      expect(result.error).toBe('RESEND_INVALID_DESTINATION');
    }
    expect(fetchCalls).toBe(0);
  });

  it('9. subjects are header-injection safe; empty-after-sanitize subjects are rejected', async () => {
    const calls: Array<{ init: MockFetchInit }> = [];
    const provider = new ResendEmailProvider(
      { baseUrl: 'https://api.resend.com', apiKey: API_KEY, from: 'noreply@monienaija.ng', requestTimeoutMs: 5000 },
      async (_url, init) => {
        calls.push({ init });
        return { ok: true, status: 200, json: async () => ({ id: 'msg-9' }) };
      },
    );

    const injected = await provider.send(request({ subject: 'Transfer\r\nBcc: attacker@evil.com' }));
    expect(injected.success).toBe(true);
    const body = JSON.parse(calls[0]!.init.body) as { subject: string };
    expect(body.subject).not.toContain('\r');
    expect(body.subject).not.toContain('\n');
    expect(body.subject).toBe('Transfer Bcc: attacker@evil.com');

    const empty = await provider.send(request({ subject: '\u0000\u001f  ' }));
    expect(empty).toEqual({ success: false, error: 'RESEND_MISSING_SUBJECT' });

    expect(sanitizeHeader('a'.repeat(400)).length).toBe(300);
  });

  it('10. SMS/PUSH channels never route through the email adapter', async () => {
    let fetchCalls = 0;
    const provider = new ResendEmailProvider(
      { baseUrl: 'https://api.resend.com', apiKey: API_KEY, from: 'noreply@monienaija.ng', requestTimeoutMs: 5000 },
      async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, json: async () => ({ id: 'x' }) };
      },
    );

    const sms = await provider.send(request({ channel: 'SMS' }));
    expect(sms).toEqual({ success: false, error: 'RESEND_UNSUPPORTED_CHANNEL:SMS' });
    expect(fetchCalls).toBe(0);
  });

  it('11. 2xx without a usable id → RESEND_UNRECOGNIZED_SUCCESS_RESPONSE (never claims false SENT)', async () => {
    const provider = new ResendEmailProvider(
      { baseUrl: 'https://api.resend.com', apiKey: API_KEY, from: 'noreply@monienaija.ng', requestTimeoutMs: 5000 },
      async () => ({ ok: true, status: 200, json: async () => ({}) }),
    );

    const result = await provider.send(request());
    expect(result).toEqual({ success: false, error: 'RESEND_UNRECOGNIZED_SUCCESS_RESPONSE' });
  });

  it('12. empty body (no text and no html) is rejected locally', async () => {
    const provider = new ResendEmailProvider(
      { baseUrl: 'https://api.resend.com', apiKey: API_KEY, from: 'noreply@monienaija.ng', requestTimeoutMs: 5000 },
      async () => ({ ok: true, status: 200, json: async () => ({ id: 'x' }) }),
    );

    const result = await provider.send(request({ message: '', html: undefined }));
    expect(result).toEqual({ success: false, error: 'RESEND_EMPTY_BODY' });
  });

  it('13. F-01: converts 2xx Resend response ids containing credential/financial sentinels into opaque HMAC digests and rejects malformed/overlong/control-char ids without truncation', async () => {
    const sentinels = [
      're_2XX_CRED_SENTINEL_11223344556677889900',
      'xkeysib-2XX_BREVO_SENTINEL_AABBCCDDEE',
      'robe_2XX_ROBASE_SENTINEL_998877665544',
      'MNNPS1:v1:CIPHERTEXT_LEAK:CCCC:DDDD',
      'TX_NGN_84000000_ACCT_9876543210_PIN_1938_OTP_552019',
    ];

    for (const rawId of sentinels) {
      const provider = new ResendEmailProvider(
        {
          baseUrl: 'https://api.resend.com',
          apiKey: API_KEY,
          from: 'noreply@monienaija.ng',
          requestTimeoutMs: 5000,
        },
        async () => ({ ok: true, status: 200, json: async () => ({ id: rawId }) }),
      );
      const res = await provider.send(request());
      expect(res.success).toBe(true);
      expect(res.providerRef).toMatch(/^pvr1:resend:[0-9a-f]{32}$/);
      const serialized = JSON.stringify(res);
      expect(serialized).not.toContain(rawId);
      expect(serialized).not.toContain('SENTINEL');
      expect(serialized).not.toContain('re_2XX');
      expect(serialized).not.toContain('xkeysib-');
      expect(serialized).not.toContain('robe_');
      expect(serialized).not.toContain('MNNPS1');
      expect(serialized).not.toContain('84000000');
      expect(serialized).not.toContain('9876543210');
    }

    const malformedIds: unknown[] = [
      undefined,
      null,
      '',
      '   ',
      999,
      false,
      ['re_array_id'],
      { id: 're_nested_id' },
      're_overlong_' + 'y'.repeat(600),
      're_crlf\r\ninjected',
      're_nul\u0000byte',
      're_del\u007fchar',
    ];

    for (const badId of malformedIds) {
      const provider = new ResendEmailProvider(
        {
          baseUrl: 'https://api.resend.com',
          apiKey: API_KEY,
          from: 'noreply@monienaija.ng',
          requestTimeoutMs: 5000,
        },
        async () => ({ ok: true, status: 200, json: async () => ({ id: badId }) }),
      );
      const res = await provider.send(request());
      expect(res).toEqual({ success: false, error: 'RESEND_UNRECOGNIZED_SUCCESS_RESPONSE' });
    }
  });
});

describe('EMAIL environment configuration validation (validateEnvironment)', () => {
  const baseEnv: Record<string, unknown> = {
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_NAME: 'monienaija',
    DB_USER: 'postgres',
    DB_PASSWORD: 'postgres',
  };

  it('1a. email provider defaults to none with sane defaults; SMS untouched', () => {
    const env = validateEnvironment(baseEnv);
    expect(env.NOTIFICATION_EMAIL_PROVIDER).toBe('none');
    expect(env.RESEND_API_BASE_URL).toBe('https://api.resend.com');
    expect(env.RESEND_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(env.NOTIFICATION_SMS_PROVIDER).toBe('console');
  });

  it('1b. provider=resend without RESEND_API_KEY fails startup validation', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NOTIFICATION_EMAIL_PROVIDER: 'resend',
        NOTIFICATION_EMAIL_FROM: 'MonieNaija <notifications@monienaija.ng>',
      }),
    ).toThrow(/RESEND_API_KEY is required/);
  });

  it('1c. provider=resend rejects keys without the re_ live-key prefix', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NOTIFICATION_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 'notaresendkey_1234567890',
        NOTIFICATION_EMAIL_FROM: 'notifications@monienaija.ng',
      }),
    ).toThrow(/re_ prefix/);
  });

  it('1d. provider=resend requires a sender identity containing @', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NOTIFICATION_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: API_KEY,
        NOTIFICATION_EMAIL_FROM: 'MonieNaija Notifications',
      }),
    ).toThrow(/NOTIFICATION_EMAIL_FROM/);
  });

  it('1e. provider=resend with valid key + sender passes', () => {
    const env = validateEnvironment({
      ...baseEnv,
      NOTIFICATION_EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: API_KEY,
      NOTIFICATION_EMAIL_FROM: 'MonieNaija <notifications@monienaija.ng>',
    });
    expect(env.NOTIFICATION_EMAIL_PROVIDER).toBe('resend');
    expect(env.RESEND_API_KEY).toBe(API_KEY);
  });

  it('1f. production rejects the console email adapter but allows dark (none)', () => {
    const productionBase = { ...baseEnv, NODE_ENV: 'production', NOTIFICATION_SMS_PROVIDER: 'robase', ROBASE_API_KEY: 'robe_' + 'b'.repeat(64) };
    expect(() =>
      validateEnvironment({ ...productionBase, NOTIFICATION_EMAIL_PROVIDER: 'console' }),
    ).toThrow(/restricted to development\/test/);
    const env = validateEnvironment({ ...productionBase, NOTIFICATION_EMAIL_PROVIDER: 'none' });
    expect(env.NOTIFICATION_EMAIL_PROVIDER).toBe('none');
  });

  it('1g. reply-to without @ is rejected; timeout bounds enforced', () => {
    expect(() =>
      validateEnvironment({ ...baseEnv, NOTIFICATION_EMAIL_REPLY_TO: 'not-an-address' }),
    ).toThrow(/NOTIFICATION_EMAIL_REPLY_TO/);
    expect(() =>
      validateEnvironment({ ...baseEnv, RESEND_REQUEST_TIMEOUT_MS: '10' }),
    ).toThrow();
    expect(() =>
      validateEnvironment({ ...baseEnv, NOTIFICATION_EMAIL_PROVIDER: 'unknown' }),
    ).toThrow();
  });
});
