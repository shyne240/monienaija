/**
 * Token coordination and error mapping.
 *
 * Both are places where a plausible implementation looks correct and fails only under load or only
 * against a real provider, so they are tested for the specific hazards rather than for happy path.
 */
import { MonnifyTokenManager } from '../src/banking/monnify/monnify-token.manager';
import {
  fromMonnifyEnvelope,
  sanitizeProviderText,
  type MonnifyEnvelope,
} from '../src/banking/monnify/monnify.errors';

describe('MonnifyTokenManager', () => {
  it('reuses a cached token instead of logging in per request', async () => {
    let logins = 0;
    const manager = new MonnifyTokenManager({
      login: () => {
        logins += 1;
        return Promise.resolve({ accessToken: `t${logins}`, expiresIn: 3600 });
      },
    });
    const first = await manager.getToken();
    const second = await manager.getToken();
    expect(first).toEqual({ ok: true, token: 't1' });
    expect(second).toEqual({ ok: true, token: 't1' });
    expect(logins).toBe(1);
  });

  it('shares ONE login across concurrent callers — the thundering-herd guard', async () => {
    let logins = 0;
    const manager = new MonnifyTokenManager({
      login: () => {
        logins += 1;
        // A real delay is what opens the window; without it the first login could finish first and
        // the race would never be observable.
        return new Promise((resolve) =>
          setTimeout(() => resolve({ accessToken: 'shared', expiresIn: 3600 }), 10),
        );
      },
    });
    const results = await Promise.all([
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
    ]);
    expect(logins).toBe(1);
    expect(results.every((r) => r.ok && r.token === 'shared')).toBe(true);
  });

  it('refreshes when the token is inside its safety margin', async () => {
    let now = 1_000_000;
    let logins = 0;
    const manager = new MonnifyTokenManager({
      now: () => now,
      login: () => {
        logins += 1;
        return Promise.resolve({ accessToken: `t${logins}`, expiresIn: 60 });
      },
    });
    await manager.getToken();
    expect(logins).toBe(1);
    // 60s lifetime, 30s margin => expires_at is +30s. Advance past it.
    now += 40_000;
    const refreshed = await manager.getToken();
    expect(refreshed).toEqual({ ok: true, token: 't2' });
    expect(logins).toBe(2);
  });

  it('does not cache a failed login, so one transient failure does not poison the client', async () => {
    let attempt = 0;
    const manager = new MonnifyTokenManager({
      login: () => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error('provider down'));
        return Promise.resolve({ accessToken: 'recovered', expiresIn: 3600 });
      },
    });
    const failed = await manager.getToken();
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('MONNIFY_AUTHENTICATION_FAILED');

    // A later caller must be able to succeed rather than inherit the rejection.
    const recovered = await manager.getToken();
    expect(recovered).toEqual({ ok: true, token: 'recovered' });
    expect(attempt).toBe(2);
  });

  it('rejects a malformed token response rather than caching an unusable token', async () => {
    const manager = new MonnifyTokenManager({
      login: () => Promise.resolve({ accessToken: '', expiresIn: 0 }),
    });
    const result = await manager.getToken();
    expect(result.ok).toBe(false);
    expect(manager.hasUsableToken()).toBe(false);
  });

  it('does not start a login for an already-cancelled request', async () => {
    let logins = 0;
    const manager = new MonnifyTokenManager({
      login: () => {
        logins += 1;
        return Promise.resolve({ accessToken: 'x', expiresIn: 3600 });
      },
    });
    const controller = new AbortController();
    controller.abort();
    const result = await manager.getToken(controller.signal);
    expect(result.ok).toBe(false);
    expect(logins).toBe(0);
  });

  it('invalidate() forces a new login after an authenticated rejection', async () => {
    let logins = 0;
    const manager = new MonnifyTokenManager({
      login: () => {
        logins += 1;
        return Promise.resolve({ accessToken: `t${logins}`, expiresIn: 3600 });
      },
    });
    await manager.getToken();
    manager.invalidate();
    const next = await manager.getToken();
    expect(next).toEqual({ ok: true, token: 't2' });
    expect(logins).toBe(2);
  });
});

describe('Monnify envelope mapping', () => {
  const envelope = (over: Partial<MonnifyEnvelope>): MonnifyEnvelope => ({ ...over });

  it('treats requestSuccessful:false with HTTP 200 as a provider rejection', () => {
    const result = fromMonnifyEnvelope(
      envelope({ requestSuccessful: false, responseCode: '99', responseMessage: 'Bad request' }),
    );
    expect(result.ok).toBe(false);
    // Code 99 is documented as the rate-limit style business code.
    if (!result.ok) expect(result.error.category).toBe('RATE_LIMITED');
  });

  it('separates entitlement refusal from ordinary rejection', () => {
    const result = fromMonnifyEnvelope(
      envelope({
        requestSuccessful: false,
        responseCode: 'R404',
        responseMessage: 'Product not enabled for this merchant',
      }),
    );
    expect(result.ok).toBe(false);
    // The remedy is commercial, not technical, so the category must say so.
    if (!result.ok) expect(result.error.category).toBe('ENTITLEMENT');
  });

  it('does not conclude success when requestSuccessful is absent', () => {
    const result = fromMonnifyEnvelope(envelope({ responseBody: { accounts: [] } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MONNIFY_MALFORMED_RESPONSE');
  });

  it('passes the body through for a genuinely successful envelope', () => {
    const result = fromMonnifyEnvelope(
      envelope({
        requestSuccessful: true,
        responseCode: '0',
        responseBody: { accountNumber: '123' },
      }),
    );
    expect(result).toEqual({ ok: true, body: { accountNumber: '123' } });
  });

  it('refuses a non-object response instead of throwing', () => {
    const result = fromMonnifyEnvelope('not json');
    expect(result.ok).toBe(false);
  });

  it('scrubs credential-like text out of provider messages', () => {
    expect(sanitizeProviderText('api_key=MK_TEST_ABC123 rejected')).toBe('[REDACTED] rejected');
    expect(sanitizeProviderText('authorization: Bearer abc.def')).toBe('[REDACTED]');
    // Ordinary messages are preserved — scrubbing must not destroy useful information.
    expect(sanitizeProviderText('Insufficient wallet balance')).toBe('Insufficient wallet balance');
  });

  it('bounds an absurdly long provider message', () => {
    const out = sanitizeProviderText('x'.repeat(5000));
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThanOrEqual(500);
  });
});
