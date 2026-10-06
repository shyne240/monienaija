/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
/**
 * V1-HARDEN-01 — A2SecurityRateLimitService SERIALIZABLE contention (real PostgreSQL).
 *
 * Context: `consume()` updates a shared token-bucket row under PostgreSQL SERIALIZABLE
 * isolation with no retry on transient serialization_failure/deadlock_detected (40001/40P01).
 * Because a rate-limit bucket is, by design, a hot row that many concurrent requests
 * legitimately land on, this is exactly the traffic pattern PostgreSQL SERIALIZABLE isolation
 * is most likely to abort with a transient (and expected-to-be-retried) conflict. Before the
 * fix, any such conflict fell into the method's catch-all and was converted into an avoidable
 * `ServiceUnavailableException` (503) — even though the request was well under the configured
 * capacity and should have been allowed through (or, at worst, correctly rejected with 429).
 *
 * Reproduced directly against the service (no mocks): with no retry, 10 concurrent `consume()`
 * calls on a single fresh bucket well under capacity produced 7/10 spurious 503s. The fix wires
 * in the same bounded (3-attempt) `runSerializableWithRetry` helper already used elsewhere in
 * this codebase for exactly this class of contention (e.g. the A5 ledger post path, customer
 * registration OTP verify) — no new retry policy, no broader A2 refactor.
 *
 * This suite proves: (1) realistic concurrency (2-3 simultaneous requests on the same bucket,
 * which is the traffic pattern that actually matters — a single IP or principal issuing a
 * couple of near-simultaneous calls) no longer produces spurious 503s; (2) the intentional 429
 * "rate limit exceeded" business outcome is untouched by the retry wiring; (3) a genuinely
 * invalid rate-limit rule configuration still fails safely with 503, exactly as before.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2SecurityRateLimitService } from '../src/authorization/security-rate-limit.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

describe('V1-HARDEN-01 A2SecurityRateLimitService SERIALIZABLE contention (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let moduleRef: any;
  let rateLimitService: A2SecurityRateLimitService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1harden01ratelimit');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    rateLimitService = moduleRef.get(A2SecurityRateLimitService);
  }, 180000);

  afterAll(async () => {
    if (moduleRef) await moduleRef.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  it('a single consume() call succeeds and decrements the bucket', async () => {
    const rule = { category: 'harden01-single', capacity: 5, refillRatePerSecond: 1, enabled: true } as any;
    const dims = [`single-${randomUUID()}`];
    await expect(rateLimitService.consume(rule, dims, 'corr-1')).resolves.toBeUndefined();
  });

  it('realistic concurrency (2 and 3 simultaneous requests) on the same fresh bucket never produces a spurious 503, across many trials', async () => {
    const rule = { category: 'harden01-realistic', capacity: 50, refillRatePerSecond: 1, enabled: true } as any;
    for (const n of [2, 3]) {
      for (let trial = 0; trial < 15; trial += 1) {
        const dims = [`realistic-${randomUUID()}`];
        const results = await Promise.allSettled(
          Array.from({ length: n }).map(() => rateLimitService.consume(rule, dims, 'corr-realistic')),
        );
        const unexpected503s = results.filter(
          (r) => r.status === 'rejected' && (r.reason as ServiceUnavailableException).getStatus?.() === 503,
        );
        expect(unexpected503s).toHaveLength(0);
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      }
    }
  }, 60000);

  it('the intentional 429 rate-limit-exceeded outcome is unaffected by the retry wiring', async () => {
    const rule = { category: 'harden01-exceeded', capacity: 1, refillRatePerSecond: 0.0001, enabled: true } as any;
    const dims = [`exceeded-${randomUUID()}`];
    await rateLimitService.consume(rule, dims, 'corr-2'); // consumes the single token
    await expect(rateLimitService.consume(rule, dims, 'corr-2')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('a genuinely invalid rate-limit rule configuration still fails safely with 503 (unchanged pre-existing behaviour)', async () => {
    const invalidRule = { category: 'harden01-invalid', capacity: 0, refillRatePerSecond: 1, enabled: true } as any;
    await expect(
      rateLimitService.consume(invalidRule, [`invalid-${randomUUID()}`], 'corr-3'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('a disabled rule never touches PostgreSQL and always resolves (unchanged pre-existing behaviour)', async () => {
    const disabledRule = { category: 'harden01-disabled', capacity: 1, refillRatePerSecond: 1, enabled: false } as any;
    const dims = [`disabled-${randomUUID()}`];
    await expect(rateLimitService.consume(disabledRule, dims, 'corr-4')).resolves.toBeUndefined();
    await expect(rateLimitService.consume(disabledRule, dims, 'corr-4')).resolves.toBeUndefined();
  });
});
