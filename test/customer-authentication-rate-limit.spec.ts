import { HttpException, ServiceUnavailableException } from '@nestjs/common';

import {
  CUSTOMER_AUTH_ACCOUNT_CATEGORY,
  CUSTOMER_AUTH_IP_CATEGORY,
  CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS,
  customerAuthenticationRateLimitRule,
  customerAuthenticationRateLimits,
} from '../src/customer-authentication/customer-authentication-rate-limit.config';
import { A2SecurityRateLimitService } from '../src/authorization/security-rate-limit.service';
import type { A2RateLimitRuleV1 } from '../src/authorization/workforce-authentication.types';
import { CustomerSessionController } from '../src/customer-authentication/customer-session.controller';
import type { AuditService } from '../src/operations/audit.service';
import type { DataSource } from 'typeorm';

const CUSTOMER_A = '00000000-0000-4000-8000-00000000000a';
const SESSION_A = '00000000-0000-4000-8000-0000000000a2';

interface BucketRow {
  id: string;
  bucketKey: string;
  category: string;
  tokens: number;
  lastRefillAt: Date;
  expiresAt: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal in-memory stand-in for the security rate-limit table. */
class FakeBucketRepository {
  readonly rows = new Map<string, BucketRow>();

  createQueryBuilder() {
    let key = '';
    const builder = {
      where: (_clause: string, parameters: { bucketKey: string }) => {
        key = parameters.bucketKey;
        return builder;
      },
      setLock: () => builder,
      getOne: () => Promise.resolve(this.rows.get(key) ?? null),
    };
    return builder;
  }

  create(values: BucketRow): BucketRow {
    return { ...values };
  }

  save(values: BucketRow): Promise<BucketRow> {
    this.rows.set(values.bucketKey, { ...values });
    return Promise.resolve(values);
  }
}

function rateLimitService(failTransactions = false) {
  const repository = new FakeBucketRepository();
  const dataSource = {
    transaction: async (_mode: string, run: (manager: unknown) => Promise<unknown>) => {
      if (failTransactions) throw new Error('database unavailable');
      return run({ getRepository: () => repository });
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new A2SecurityRateLimitService(
    dataSource as unknown as DataSource,
    audit as unknown as AuditService,
  );
  return { service, repository, audit };
}

describe('customer authentication rate-limit configuration', () => {
  it('defaults to enabled per-address and per-account buckets', () => {
    const rules = customerAuthenticationRateLimits(undefined);

    expect(rules).toEqual(CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS);
    expect(rules.map((rule) => rule.category).sort()).toEqual(
      [CUSTOMER_AUTH_ACCOUNT_CATEGORY, CUSTOMER_AUTH_IP_CATEGORY].sort(),
    );
    expect(rules.every((rule) => rule.enabled)).toBe(true);
  });

  it('accepts an explicit override, including a documented opt-out', () => {
    const rules = customerAuthenticationRateLimits(
      JSON.stringify([
        {
          category: CUSTOMER_AUTH_IP_CATEGORY,
          capacity: 5,
          refillRatePerSecond: 0.1,
          enabled: true,
        },
        {
          category: CUSTOMER_AUTH_ACCOUNT_CATEGORY,
          capacity: 5,
          refillRatePerSecond: 0.1,
          enabled: false,
        },
      ]),
    );

    expect(customerAuthenticationRateLimitRule(rules, CUSTOMER_AUTH_IP_CATEGORY).capacity).toBe(5);
    expect(customerAuthenticationRateLimitRule(rules, CUSTOMER_AUTH_ACCOUNT_CATEGORY).enabled).toBe(
      false,
    );
  });

  it.each([
    ['malformed JSON', '{'],
    ['not an array', '{"category":"x"}'],
    ['empty array', '[]'],
    [
      'duplicate category',
      JSON.stringify([CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS[0], CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS[0]]),
    ],
    ['missing required category', JSON.stringify([CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS[0]])],
    [
      'invalid capacity',
      JSON.stringify([
        { ...CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS[0], capacity: 0 },
        CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS[1],
      ]),
    ],
  ])('fails closed on %s', (_label, value) => {
    expect(() => customerAuthenticationRateLimits(value)).toThrow(/CUSTOMER_AUTH_RATE_LIMITS_JSON/);
  });

  it('reports a missing rule as a configuration failure rather than skipping the control', () => {
    expect(() => customerAuthenticationRateLimitRule([], CUSTOMER_AUTH_IP_CATEGORY)).toThrow(
      /rate-limit policy missing/,
    );
  });
});

describe('A2SecurityRateLimitService token bucket', () => {
  const rule = {
    category: CUSTOMER_AUTH_IP_CATEGORY,
    capacity: 2,
    refillRatePerSecond: 1,
    enabled: true,
  };
  const start = new Date('2026-01-01T00:00:00.000Z');

  it('allows up to capacity, rejects with 429, then refills deterministically', async () => {
    const { service, audit } = rateLimitService();

    await service.consume(rule, ['203.0.113.7'], 'correlation-1', start);
    await service.consume(rule, ['203.0.113.7'], 'correlation-2', start);
    await expect(
      service.consume(rule, ['203.0.113.7'], 'correlation-3', start),
    ).rejects.toMatchObject({ status: 429 });
    expect(audit.record).toHaveBeenCalledTimes(1);

    // Two seconds later the bucket has refilled to capacity, so the caller is served again.
    const later = new Date(start.getTime() + 2_000);
    await expect(
      service.consume(rule, ['203.0.113.7'], 'correlation-4', later),
    ).resolves.toBeUndefined();
  });

  it('keeps buckets separate per dimension value', async () => {
    const { service } = rateLimitService();

    await service.consume(rule, ['203.0.113.7'], 'correlation-1', start);
    await service.consume(rule, ['203.0.113.7'], 'correlation-2', start);
    await expect(
      service.consume(rule, ['198.51.100.9'], 'correlation-3', start),
    ).resolves.toBeUndefined();
  });

  it('does no work when a rule is explicitly disabled', async () => {
    const { service, repository } = rateLimitService();

    await service.consume({ ...rule, enabled: false }, ['203.0.113.7'], 'correlation-1', start);
    expect(repository.rows.size).toBe(0);
  });

  it('fails closed when the limiter state is unavailable', async () => {
    const { service } = rateLimitService(true);

    await expect(
      service.consume(rule, ['203.0.113.7'], 'correlation-1', start),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects an invalid rule instead of allowing unlimited traffic', async () => {
    const { service } = rateLimitService();

    await expect(
      service.consume({ ...rule, capacity: 0 }, ['203.0.113.7'], 'correlation-1', start),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('customer credential exchange throttling', () => {
  const runtime = { authenticateCustomer: jest.fn() };
  const sessions = { getSession: jest.fn() };
  const limiter = {
    consume: jest.fn<Promise<void>, [A2RateLimitRuleV1, readonly string[], string]>(),
  };
  let controller: CustomerSessionController;

  const request = { ip: '203.0.113.7', headers: {}, id: 'request-1' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    limiter.consume.mockResolvedValue(undefined);
    controller = new CustomerSessionController(
      runtime as never,
      sessions as never,
      limiter as never,
      CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS,
    );
  });

  const authenticate = () =>
    controller.authenticate(CUSTOMER_A, { password: 'correct horse battery staple' }, request);

  it('throttles per client address and per account before verifying credentials', async () => {
    runtime.authenticateCustomer.mockResolvedValue({
      authenticated: true,
      customerId: CUSTOMER_A,
      session: {
        accessToken: 'issued-token',
        tokenType: 'Bearer',
        sessionId: SESSION_A,
        audience: 'customer-api',
        expiresAt: new Date('2026-01-01T01:00:00.000Z'),
      },
    });

    const response = await authenticate();

    expect(response.session.accessToken).toBe('issued-token');
    expect(limiter.consume.mock.calls.map((call) => call[0].category)).toEqual([
      CUSTOMER_AUTH_IP_CATEGORY,
      CUSTOMER_AUTH_ACCOUNT_CATEGORY,
    ]);
    expect(limiter.consume.mock.calls[0]?.[1]).toEqual(['203.0.113.7']);
    expect(limiter.consume.mock.calls[1]?.[1]).toEqual([CUSTOMER_A]);
    expect(JSON.stringify(response)).not.toContain('password');
  });

  it('does not verify credentials once the address bucket rejects the call', async () => {
    limiter.consume.mockRejectedValueOnce(new HttpException('Security request rate exceeded', 429));

    await expect(authenticate()).rejects.toMatchObject({ status: 429 });
    expect(runtime.authenticateCustomer).not.toHaveBeenCalled();
    expect(limiter.consume).toHaveBeenCalledTimes(1);
  });

  it('does not verify credentials when the account bucket rejects the call', async () => {
    limiter.consume
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new HttpException('Security request rate exceeded', 429));

    await expect(authenticate()).rejects.toMatchObject({ status: 429 });
    expect(runtime.authenticateCustomer).not.toHaveBeenCalled();
    expect(limiter.consume).toHaveBeenCalledTimes(2);
  });

  it('keeps the generic 401 for refused credentials after throttling', async () => {
    runtime.authenticateCustomer.mockResolvedValue({
      authenticated: false,
      customerId: CUSTOMER_A,
      failureReason: 'INVALID_CREDENTIALS',
    });

    await expect(authenticate()).rejects.toMatchObject({
      status: 401,
      message: 'Invalid credentials',
    });
  });
});
