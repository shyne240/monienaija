/* eslint-disable @typescript-eslint/require-await */
import type { NotificationSendRequest } from '../src/notification/notification.types';
import { RobaseNotificationProvider } from '../src/notification/robase-notification-provider';
import { validateEnvironment } from '../src/config/environment';

/**
 * SMS-V1-01 — Robase adapter contract unit tests (no network, no DB).
 * The fetch dependency is mocked; assertions restrict themselves to the verified
 * official contract (docs.robase.dev): POST /v1/sms/send, Bearer robe_* auth,
 * Idempotency-Key header, {phone_number, message, metadata} body, {id} success payload,
 * {error:{type}} failure envelope.
 */

const API_KEY = 'robe_' + 'a'.repeat(64);

function request(overrides: Partial<NotificationSendRequest> = {}): NotificationSendRequest {
  return {
    channel: 'SMS',
    destination: '2348012345678',
    message: 'Transfer NGN 250.00 completed. Ref 4d2c1d01.',
    payload: {},
    correlationId: 'corr-1',
    eventType: 'transfer.completed',
    eventKey: 'transfer.completed:tx-1:2026-09-28',
    recipientType: 'CUSTOMER',
    recipientId: 'cust-1',
    ...overrides,
  };
}

type MockFetchInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

describe('RobaseNotificationProvider (verified contract, mocked transport)', () => {
  it('1. successful submission → success + providerRef; verified request shape', async () => {
    const calls: Array<{ url: string; init: MockFetchInit }> = [];
    const provider = new RobaseNotificationProvider(
      { baseUrl: 'https://api.robase.dev', apiKey: API_KEY, requestTimeoutMs: 5000 },
      async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: '3c90c3cc-0d44-4b50-8888-8dd25736052a',
            status: 'pending',
            country_code: 'NG',
            credit_cost: 1,
            segments: 1,
          }),
        };
      },
    );

    const result = await provider.send(request());

    expect(result.success).toBe(true);
    expect(result.providerRef).toBe('3c90c3cc-0d44-4b50-8888-8dd25736052a');
    expect(calls.length).toBe(1);
    // Verified contract: endpoint /v1/sms/send
    expect(calls[0]!.url).toBe('https://api.robase.dev/v1/sms/send');
    expect(calls[0]!.init.method).toBe('POST');
    // Verified contract: Bearer robe_* auth, JSON content, Idempotency-Key
    expect(calls[0]!.init.headers['Authorization']).toBe(`Bearer ${API_KEY}`);
    expect(calls[0]!.init.headers['Content-Type']).toBe('application/json');
    expect(calls[0]!.init.headers['Idempotency-Key']).toBe(
      'transfer.completed:tx-1:2026-09-28:cust-1:SMS',
    );
    // Verified contract body: phone E.164 (destination re-fixed deterministically),
    // message, metadata carrying only non-secret event identifiers.
    const body = JSON.parse(calls[0]!.init.body) as Record<string, unknown>;
    expect(body['phone_number']).toBe('+2348012345678');
    expect(body['message']).toContain('Ref 4d2c1d01.');
    expect(body['metadata']).toEqual({ event_type: 'transfer.completed' });
    expect(JSON.stringify(body)).not.toContain('ledger');
    expect(JSON.stringify(body)).not.toContain('journal');
  });

  it('2. provider failure envelope → success=false with stable error type only', async () => {
    const provider = new RobaseNotificationProvider(
      { baseUrl: 'https://api.robase.dev', apiKey: API_KEY, requestTimeoutMs: 5000 },
      async () => ({
        ok: false,
        status: 402,
        json: async () => ({ error: { type: 'insufficient_credits', message: 'Top up now' } }),
      }),
    );

    const result = await provider.send(request());

    expect(result.success).toBe(false);
    expect(result.error).toBe('ROBASE_HTTP_402:insufficient_credits');
    // No prose, no secrets, no key material in the error surface.
    expect(result.error).not.toContain('Top up');
    expect(result.error).not.toContain(API_KEY);
    expect(result.error).not.toContain('robe_');
  });

  it('3. non-JSON provider failure body → generic typed error', async () => {
    const provider = new RobaseNotificationProvider(
      { baseUrl: 'https://api.robase.dev', apiKey: API_KEY, requestTimeoutMs: 5000 },
      async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      }),
    );

    const result = await provider.send(request());
    expect(result.success).toBe(false);
    expect(result.error).toBe('ROBASE_HTTP_502:unknown');
  });

  it('4. timeout → ROBASE_TIMEOUT, never throws', async () => {
    const provider = new RobaseNotificationProvider(
      { baseUrl: 'https://api.robase.dev', apiKey: API_KEY, requestTimeoutMs: 1 },
      async (_url, init) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (init.signal.aborted) {
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        }
        return { ok: true, status: 200, json: async () => ({ id: 'late' }) };
      },
    );

    const result = await provider.send(request());
    expect(result.success).toBe(false);
    expect(result.error).toBe('ROBASE_TIMEOUT');
  });

  it('5. network error → typed network failure, never throws', async () => {
    const provider = new RobaseNotificationProvider(
      { baseUrl: 'https://api.robase.dev', apiKey: API_KEY, requestTimeoutMs: 5000 },
      async () => {
        throw new TypeError('fetch failed');
      },
    );

    const result = await provider.send(request());
    expect(result.success).toBe(false);
    expect(result.error).toBe('ROBASE_NETWORK:TypeError');
  });

  it('6. destination normalization: '+ '+E.164 preserved, bare digits prefixed, garbage rejected', async () => {
    const calls: string[] = [];
    const provider = new RobaseNotificationProvider(
      { baseUrl: 'https://api.robase.dev', apiKey: API_KEY, requestTimeoutMs: 5000 },
      async (_url, init) => {
        calls.push((JSON.parse(init.body) as { phone_number: string }).phone_number);
        return { ok: true, status: 200, json: async () => ({ id: 'ok' }) };
      },
    );

    await provider.send(request({ destination: '+2348012345678' }));
    await provider.send(request({ destination: '2348012345678' }));
    expect(calls).toEqual(['+2348012345678', '+2348012345678']);

    const skipped = await provider.send(request({ destination: 'SKIPPED:CUSTOMER_PHONE_MISSING' }));
    expect(skipped.success).toBe(false);
    expect(skipped.error).toBe('ROBASE_INVALID_DESTINATION');
    expect(calls.length).toBe(2); // no extra request for invalid destination
  });

  it('7. PUSH channel rejected as unsupported (documented dependency)', async () => {
    const provider = new RobaseNotificationProvider(
      { baseUrl: 'https://api.robase.dev', apiKey: API_KEY, requestTimeoutMs: 5000 },
      async () => {
        throw new Error('should not be called');
      },
    );
    const result = await provider.send(request({ channel: 'PUSH', destination: 'token-1' }));
    expect(result.success).toBe(false);
    expect(result.error).toBe('ROBASE_UNSUPPORTED_CHANNEL:PUSH');
  });

  it('15. secrets never appear in any returned surface across failure modes', async () => {
    const cases: Array<() => Promise<{ success: boolean; error?: string | null }>> = [];
    cases.push(async () =>
      (
        await new RobaseNotificationProvider(
          { baseUrl: 'https://api.robase.dev', apiKey: API_KEY, requestTimeoutMs: 5000 },
          async () => ({ ok: false, status: 401, json: async () => ({ error: { type: 'unauthorized', message: `bad key ${API_KEY}` } }) }),
        ).send(request())
      ),
    );
    cases.push(async () =>
      (
        await new RobaseNotificationProvider(
          { baseUrl: 'https://api.robase.dev', apiKey: API_KEY, requestTimeoutMs: 5000 },
          async () => {
            throw new TypeError(`network error while using ${API_KEY}`);
          },
        ).send(request())
      ),
    );
    for (const run of cases) {
      const result = await run();
      const surface = JSON.stringify(result);
      expect(surface).not.toContain(API_KEY);
      expect(surface).not.toContain('aaaa'); // never echo key material fragments
    }
  });
});

describe('Robase environment configuration validation (validateEnvironment)', () => {
  const baseEnv: Record<string, unknown> = {
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_NAME: 'monienaija',
    DB_USER: 'postgres',
    DB_PASSWORD: 'postgres',
  };

  it('1a. provider=robase without ROBASE_API_KEY fails startup validation', () => {
    expect(() => validateEnvironment({ ...baseEnv, NOTIFICATION_SMS_PROVIDER: 'robase' })).toThrow(
      /ROBASE_API_KEY is required/,
    );
  });

  it('1b. provider=robase rejects keys without the verified robe_ live-key prefix', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NOTIFICATION_SMS_PROVIDER: 'robase',
        ROBASE_API_KEY: 'notarobasekey_1234567890',
      }),
    ).toThrow(/robe_ prefix/);
  });

  it('1c. provider=robase with a valid-shaped key passes and fills defaults', () => {
    const env = validateEnvironment({
      ...baseEnv,
      NOTIFICATION_SMS_PROVIDER: 'robase',
      ROBASE_API_KEY: API_KEY,
    });
    expect(env.NOTIFICATION_SMS_PROVIDER).toBe('robase');
    expect(env.ROBASE_API_BASE_URL).toBe('https://api.robase.dev');
    expect(env.ROBASE_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(env.NOTIFICATION_WORKER_ENABLED).toBe(false);
    expect(env.SMS_RETRY_MAX_ATTEMPTS).toBe(3);
    expect(env.SMS_RETRY_BASE_DELAY_SECONDS).toBe(60);
  });

  it('1d. default configuration (no SMS envs) stays provider-neutral console — no key required', () => {
    const env = validateEnvironment({ ...baseEnv });
    expect(env.NOTIFICATION_SMS_PROVIDER).toBe('console');
    expect(env.ROBASE_API_KEY).toBeUndefined();
  });
});
