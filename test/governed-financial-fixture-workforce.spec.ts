/**
 * Regression: concurrent `workforce()` callers must share ONE seeding pass.
 *
 * The governed fixture seeds six independently authenticated MFA principals lazily, on first use.
 * It used to cache only the *resolved* value, so two callers arriving before seeding finished both
 * saw `undefined` and both seeded. That is not hypothetical: `a16-agent-cash-to-cash-claim`'s
 * concurrency case calls `initiateTransfer()` twice in one `Promise.all`, and both reach the
 * fixture's workforce authority at once. The duplicate seeding issued interleaved supertest
 * requests through a single server -- the suite never calls `listen()`, so supertest binds an
 * ephemeral listener per request -- and the observable symptom was `connect ECONNRESET`, a
 * transport error with no relation to the claim behaviour under test.
 *
 * This test pins the fix at the level where the bug lived, deterministically, without a database:
 * it counts actual seeding passes across concurrent callers.
 */
import { GovernedFinancialFixture } from './support/governed-financial-fixture';

type SeededPrincipal = { principalId: string; token: string };

function makeFixture(): GovernedFinancialFixture {
  // Only the two collaborators `workforce()` touches are needed; everything else stays absent
  // because this test never reaches the HTTP or persistence layers.
  const dataSource = {
    getRepository: () => ({ save: () => Promise.resolve(undefined) }),
  } as never;
  const app = {
    get: () => ({ establish: () => Promise.resolve({ accessToken: 'token' }) }),
  } as never;
  return new GovernedFinancialFixture({
    app: app,
    dataSource: dataSource,
    label: 'workforce-race',
  });
}

/** Seeded principals are cached on the instance; the private field is readable at runtime. */
function cachedWorkforce(fixture: GovernedFinancialFixture): unknown {
  return (fixture as unknown as { workforceCache?: unknown }).workforceCache;
}

describe('GovernedFinancialFixture.workforce concurrency', () => {
  it('runs exactly one seeding pass when callers arrive concurrently', async () => {
    const fixture = makeFixture();
    const seed = jest
      .spyOn(
        fixture as unknown as { seedPrincipal: (key: string) => Promise<SeededPrincipal> },
        'seedPrincipal',
      )
      // A real delay is what opens the window: without it the first call would finish before the
      // second began and the race could never be observed.
      .mockImplementation(
        async (key: string) =>
          new Promise<SeededPrincipal>((resolve) =>
            setTimeout(() => resolve({ principalId: key, token: `t-${key}` }), 5),
          ),
      );

    const [a, b] = await Promise.all([fixture.workforce(), fixture.workforce()]);

    // Six roles, seeded once -- not twelve.
    expect(seed).toHaveBeenCalledTimes(6);
    // Both callers received the same materialised object.
    expect(a).toBe(b);
    expect(Object.keys(a).length).toBeGreaterThan(0);
    expect(cachedWorkforce(fixture)).toBe(a);
  });

  it('reuses the cache and never re-seeds on later calls', async () => {
    const fixture = makeFixture();
    const seed = jest
      .spyOn(
        fixture as unknown as { seedPrincipal: (key: string) => Promise<SeededPrincipal> },
        'seedPrincipal',
      )
      .mockImplementation((key: string) =>
        Promise.resolve({ principalId: key, token: `t-${key}` }),
      );

    const first = await fixture.workforce();
    const second = await fixture.workforce();

    expect(seed).toHaveBeenCalledTimes(6);
    expect(second).toBe(first);
  });

  it('retries seeding after a failed pass instead of caching the rejection', async () => {
    const fixture = makeFixture();
    let fail = true;
    const seed = jest
      .spyOn(
        fixture as unknown as { seedPrincipal: (key: string) => Promise<SeededPrincipal> },
        'seedPrincipal',
      )
      .mockImplementation((key: string) => {
        if (fail) return Promise.reject(new Error('seeding unavailable'));
        return Promise.resolve({ principalId: key, token: `t-${key}` });
      });

    await expect(fixture.workforce()).rejects.toThrow('seeding unavailable');
    expect(cachedWorkforce(fixture)).toBeUndefined();

    // A later caller must be able to seed successfully rather than inherit a poisoned cache.
    fail = false;
    await expect(fixture.workforce()).resolves.toBeDefined();
    expect(cachedWorkforce(fixture)).toBeDefined();
    expect(seed).toHaveBeenCalledTimes(12);
  });
});
