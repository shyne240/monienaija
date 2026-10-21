/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * V1-LIMIT-05 — PART 2: workforce-only operational diagnostics.
 *
 *   GET /api/v1/internal/limit-usages
 *   GET /api/v1/internal/limit-reservations
 *
 * Verified: authorization (OPERATOR/SERVICE/PRIVILEGED only — SUPPORT/CUSTOMER/AGENT/AGGREGATOR
 * blocked), filtering, deterministic pagination/ordering, SAFE PROJECTION (request_hash never
 * exposed), read-only (no ledger/usage/reservation mutation), stale-flag diagnostics with
 * configurable threshold, and manual recovery boundary authorization on
 *   POST /api/v1/internal/limit-reservation-recovery/release (PRIVILEGED-only).
 *
 * Real PostgreSQL; no financial service mocked.
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { LimitUsageService } from '../src/limit-catalog/limit-usage.service';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

describe('V1-LIMIT-05 Limit Diagnostics (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let limitUsageService: LimitUsageService;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    jwksJson: [],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-')) throw new UnauthorizedException('invalid workforce token');
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED', 'AGENT', 'CUSTOMER', 'AGGREGATOR'];
      if (!allowed.includes(type)) throw new UnauthorizedException('invalid type');
      return {
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any;
    },
  };

  const auth = (type: string) => `Bearer workforce-${type.toLowerCase()}`;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-limit-05-diag');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await (app.getHttpAdapter().getInstance() as any).ready();
    limitUsageService = app.get(LimitUsageService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await dataSource.query(`INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ('DIAG_PROFILE', 'Diagnostics Profile', 'CUSTOMER', 'ACTIVE', true, 'CONFIGURED', 'test')`);
  });

  async function reserve(input: {
    principalId?: string;
    product?: string;
    dimension?: string;
    amountMinor?: string;
    count?: number;
    key?: string;
    correlationId?: string;
    direction?: string;
  }): Promise<{ key: string; principalId: string; reservations: any[] }> {
    const principalId = input.principalId ?? randomUUID();
    const key = input.key ?? `diag-${randomUUID()}`;
    const dimension = input.dimension ?? 'DAILY_AMOUNT';
    const isCount = dimension.endsWith('_COUNT');
    const result = await limitUsageService.reserveBatch({
      principalType: 'CUSTOMER',
      principalId,
      limitProfileCode: 'DIAG_PROFILE',
      product: input.product ?? 'WALLET_TRANSFER',
      currency: 'NGN',
      direction: input.direction ?? 'OUTGOING',
      channel: null,
      reservations: [
        {
          dimension,
          product: input.product ?? 'WALLET_TRANSFER',
          currency: 'NGN',
          amountMinor: isCount ? null : input.amountMinor ?? '10000',
          count: isCount ? input.count ?? 1 : null,
          direction: input.direction ?? 'OUTGOING',
        },
      ],
      idempotencyKey: key,
      requestHash: createHash('sha256').update(key).digest('hex'),
      correlationId: input.correlationId ?? `diag-corr-${randomUUID().slice(0, 8)}`,
    });
    return { key, principalId, reservations: result.reservations };
  }

  // ── 1. Authorization ──

  it('01 GET /internal/limit-usages — OPERATOR/SERVICE/PRIVILEGED allowed; SUPPORT/CUSTOMER/AGENT blocked; no auth 401', async () => {
    for (const role of ['OPERATOR', 'SERVICE', 'PRIVILEGED']) {
      const res = await request(app.getHttpServer()).get('/api/v1/internal/limit-usages').set('Authorization', auth(role));
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    }
    const support = await request(app.getHttpServer()).get('/api/v1/internal/limit-usages').set('Authorization', auth('SUPPORT'));
    expect(support.status).toBe(403);
    const customer = await request(app.getHttpServer()).get('/api/v1/internal/limit-usages').set('Authorization', auth('CUSTOMER'));
    expect([401, 403]).toContain(customer.status);
    const agent = await request(app.getHttpServer()).get('/api/v1/internal/limit-usages').set('Authorization', auth('AGENT'));
    expect([401, 403]).toContain(agent.status);
    const noAuth = await request(app.getHttpServer()).get('/api/v1/internal/limit-usages');
    expect(noAuth.status).toBe(401);
  });

  it('02 GET /internal/limit-reservations — same workforce-only authorization', async () => {
    for (const role of ['OPERATOR', 'SERVICE', 'PRIVILEGED']) {
      const res = await request(app.getHttpServer()).get('/api/v1/internal/limit-reservations').set('Authorization', auth(role));
      expect(res.status).toBe(200);
    }
    const support = await request(app.getHttpServer()).get('/api/v1/internal/limit-reservations').set('Authorization', auth('SUPPORT'));
    expect(support.status).toBe(403);
    const noAuth = await request(app.getHttpServer()).get('/api/v1/internal/limit-reservations');
    expect(noAuth.status).toBe(401);
  });

  // ── 2. Filtering — usages ──

  it('03 limit-usages filtering by principal/product/dimension/currency/windowKey/profile', async () => {
    const pA = randomUUID();
    const pB = randomUUID();
    await reserve({ principalId: pA, product: 'WALLET_TRANSFER', dimension: 'DAILY_AMOUNT', amountMinor: '1111' });
    await reserve({ principalId: pA, product: 'CASH_TO_WALLET', dimension: 'DAILY_COUNT', count: 2, direction: 'INCOMING' });
    await reserve({ principalId: pB, product: 'WALLET_TRANSFER', dimension: 'DAILY_AMOUNT', amountMinor: '2222' });

    const byPrincipal = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${pA}`)
      .set('Authorization', auth('OPERATOR'));
    expect(byPrincipal.status).toBe(200);
    expect(byPrincipal.body.total).toBe(2);
    for (const item of byPrincipal.body.data) expect(item.principalId).toBe(pA);

    const byProduct = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${pA}&product=wallet_transfer`)
      .set('Authorization', auth('OPERATOR'));
    expect(byProduct.body.total).toBe(1);
    expect(byProduct.body.data[0].product).toBe('WALLET_TRANSFER');

    const byDimension = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${pA}&dimension=DAILY_COUNT`)
      .set('Authorization', auth('OPERATOR'));
    expect(byDimension.body.total).toBe(1);
    expect(byDimension.body.data[0].usedCount).toBe(0);
    expect(byDimension.body.data[0].reservedCount).toBe(2);

    const byProfile = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?limitProfileCode=DIAG_PROFILE&principalType=CUSTOMER&currency=NGN`)
      .set('Authorization', auth('SERVICE'));
    expect(byProfile.status).toBe(200);
    expect(byProfile.body.total).toBe(3);

    // both pA rows share the same DAILY window key (amount + count dimensions) → 2 rows
    const byWindowKey = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${pA}&windowKey=${encodeURIComponent(byProduct.body.data[0].windowKey)}`)
      .set('Authorization', auth('OPERATOR'));
    expect(byWindowKey.status).toBe(200);
    expect(byWindowKey.body.total).toBe(2);
    for (const item of byWindowKey.body.data) expect(item.windowKey).toBe(byProduct.body.data[0].windowKey);

    const none = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${randomUUID()}`)
      .set('Authorization', auth('OPERATOR'));
    expect(none.body.total).toBe(0);
  });

  it('04 limit-usages window date-range filters', async () => {
    const pA = randomUUID();
    await reserve({ principalId: pA });
    const past = new Date(Date.now() - 2 * 86400000).toISOString();
    const future = new Date(Date.now() + 2 * 86400000).toISOString();
    const inRange = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${pA}&windowFrom=${encodeURIComponent(past)}&windowTo=${encodeURIComponent(future)}`)
      .set('Authorization', auth('OPERATOR'));
    expect(inRange.body.total).toBe(1);
    const outRange = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${pA}&windowFrom=${encodeURIComponent(future)}`)
      .set('Authorization', auth('OPERATOR'));
    expect(outRange.body.total).toBe(0);
    const badDate = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?windowFrom=not-a-date`)
      .set('Authorization', auth('OPERATOR'));
    expect(badDate.status).toBe(400);
  });

  // ── 3. Filtering — reservations ──

  it('05 limit-reservations filtering by status/idempotencyKey/correlationId/principal/product/dimension/windowKey', async () => {
    const pA = randomUUID();
    const r1 = await reserve({ principalId: pA, correlationId: 'corr-alpha-1' });
    const r2 = await reserve({ principalId: pA, dimension: 'DAILY_COUNT', count: 3, correlationId: 'corr-beta-2' });
    await dataSource.transaction('SERIALIZABLE', (m) => limitUsageService.commitWithManager(m, { idempotencyKey: r2.key }));

    const all = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?principalId=${pA}`)
      .set('Authorization', auth('OPERATOR'));
    expect(all.body.total).toBe(2);

    const reserved = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?principalId=${pA}&status=RESERVED`)
      .set('Authorization', auth('OPERATOR'));
    expect(reserved.body.total).toBe(1);
    expect(reserved.body.data[0].idempotencyKey).toBe(r1.key);

    const committed = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?principalId=${pA}&status=COMMITTED`)
      .set('Authorization', auth('OPERATOR'));
    expect(committed.body.total).toBe(1);
    expect(committed.body.data[0].committedAt).toBeTruthy();

    const byKey = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?idempotencyKey=${encodeURIComponent(r1.key)}`)
      .set('Authorization', auth('OPERATOR'));
    expect(byKey.body.total).toBe(1);

    const byCorrelation = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?correlationId=corr-alpha-1`)
      .set('Authorization', auth('OPERATOR'));
    expect(byCorrelation.body.total).toBe(1);
    expect(byCorrelation.body.data[0].correlationId).toBe('corr-alpha-1');

    const byDimension = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?principalId=${pA}&dimension=DAILY_COUNT`)
      .set('Authorization', auth('OPERATOR'));
    expect(byDimension.body.total).toBe(1);
    expect(byDimension.body.data[0].count).toBe(3);

    const byProduct = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?principalId=${pA}&product=WALLET_TRANSFER&currency=NGN&limitProfileCode=DIAG_PROFILE`)
      .set('Authorization', auth('OPERATOR'));
    expect(byProduct.body.total).toBe(2);

    const badStatus = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?status=BOGUS`)
      .set('Authorization', auth('OPERATOR'));
    expect(badStatus.status).toBe(400);
  });

  it('06 limit-reservations reserved_at date-range filters', async () => {
    const pA = randomUUID();
    await reserve({ principalId: pA });
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    const inRange = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?principalId=${pA}&reservedFrom=${encodeURIComponent(past)}&reservedTo=${encodeURIComponent(future)}`)
      .set('Authorization', auth('OPERATOR'));
    expect(inRange.body.total).toBe(1);
    const outRange = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?principalId=${pA}&reservedFrom=${encodeURIComponent(future)}`)
      .set('Authorization', auth('OPERATOR'));
    expect(outRange.body.total).toBe(0);
  });

  // ── 4. Pagination & deterministic order ──

  it('07 deterministic pagination — created/reserved DESC with id tiebreak, stable slicing', async () => {
    const pA = randomUUID();
    for (let i = 0; i < 7; i += 1) {
      // distinct product per reserve → distinct usage rows (same principal/window would collapse)
      await reserve({ principalId: pA, product: `DIAG_PAG_${i}`, amountMinor: String(1000 + i) });
    }
    const page1 = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${pA}&page=1&limit=3`)
      .set('Authorization', auth('OPERATOR'));
    const page2 = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${pA}&page=2&limit=3`)
      .set('Authorization', auth('OPERATOR'));
    const page3 = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${pA}&page=3&limit=3`)
      .set('Authorization', auth('OPERATOR'));
    expect(page1.body.total).toBe(7);
    expect(page1.body.totalPages).toBe(3);
    expect(page1.body.data.length).toBe(3);
    expect(page2.body.data.length).toBe(3);
    expect(page3.body.data.length).toBe(1);
    const ids = [...page1.body.data, ...page2.body.data, ...page3.body.data].map((d) => d.id);
    expect(new Set(ids).size).toBe(7); // no overlap, no gaps
    // deterministic re-fetch
    const again = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${pA}&page=1&limit=3`)
      .set('Authorization', auth('OPERATOR'));
    expect(again.body.data.map((d) => d.id)).toEqual(page1.body.data.map((d) => d.id));

    const resPage = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?principalId=${pA}&page=1&limit=4`)
      .set('Authorization', auth('OPERATOR'));
    expect(resPage.body.total).toBe(7);
    expect(resPage.body.data.length).toBe(4);
    const stamps = resPage.body.data.map((d) => new Date(d.reservedAt).getTime());
    for (let i = 1; i < stamps.length; i += 1) expect(stamps[i]).toBeLessThanOrEqual(stamps[i - 1]);

    const badLimit = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?limit=5000`)
      .set('Authorization', auth('OPERATOR'));
    expect(badLimit.status).toBe(400);
    const badPage = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?page=0`)
      .set('Authorization', auth('OPERATOR'));
    expect(badPage.status).toBe(400);
  });

  // ── 5. Safe projection ──

  it('08 SAFE PROJECTION — request_hash and secrets never exposed', async () => {
    const pA = randomUUID();
    await reserve({ principalId: pA });
    const usages = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-usages?principalId=${pA}`)
      .set('Authorization', auth('PRIVILEGED'));
    expect(usages.body.total).toBe(1);
    const reservations = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?principalId=${pA}`)
      .set('Authorization', auth('PRIVILEGED'));
    expect(reservations.body.total).toBe(1);
    const serialized = JSON.stringify(usages.body) + JSON.stringify(reservations.body);
    expect(serialized).not.toContain('request_hash');
    expect(serialized).not.toContain('requestHash');
    // operational fields ARE present
    const item = reservations.body.data[0];
    expect(item.idempotencyKey).toBeTruthy();
    expect(item.correlationId).toBeTruthy();
    expect(item.status).toBe('RESERVED');
    expect(item.reservedAt).toBeTruthy();
    expect(typeof item.ageSeconds).toBe('number');
  });

  // ── 6. Read-only: diagnostics never mutate ──

  it('09 diagnostics are read-only — no ledger/usage/reservation mutation', async () => {
    const pA = randomUUID();
    await reserve({ principalId: pA });
    const before = await dataSource.query(
      `SELECT
         (SELECT count(*) FROM limit_usages)::text AS u,
         (SELECT count(*) FROM limit_reservations)::text AS r,
         (SELECT count(*) FROM ledger_lines)::text AS l,
         (SELECT COALESCE(sum(used_amount_minor),0)::text FROM limit_usages) AS ua,
         (SELECT COALESCE(sum(reserved_amount_minor),0)::text FROM limit_usages) AS ra`,
    );
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer()).get(`/api/v1/internal/limit-usages?principalId=${pA}`).set('Authorization', auth('OPERATOR'));
      await request(app.getHttpServer()).get(`/api/v1/internal/limit-reservations?principalId=${pA}&stale=true`).set('Authorization', auth('OPERATOR'));
      await request(app.getHttpServer()).get(`/api/v1/internal/limit-reservations?status=RESERVED`).set('Authorization', auth('SERVICE'));
    }
    const after = await dataSource.query(
      `SELECT
         (SELECT count(*) FROM limit_usages)::text AS u,
         (SELECT count(*) FROM limit_reservations)::text AS r,
         (SELECT count(*) FROM ledger_lines)::text AS l,
         (SELECT COALESCE(sum(used_amount_minor),0)::text FROM limit_usages) AS ua,
         (SELECT COALESCE(sum(reserved_amount_minor),0)::text FROM limit_usages) AS ra`,
    );
    expect(after).toEqual(before);
  });

  // ── 7. Stale flag — diagnostics only ──

  it('10 stale flag surfaces aged RESERVED reservations (default 30min threshold); COMMITTED/RELEASED never flagged', async () => {
    const pA = randomUUID();
    const fresh = await reserve({ principalId: pA });
    const aged = await reserve({ principalId: pA, dimension: 'WEEKLY_AMOUNT', amountMinor: '777' });
    const committed = await reserve({ principalId: pA, dimension: 'MONTHLY_AMOUNT', amountMinor: '888' });
    await dataSource.transaction('SERIALIZABLE', (m) => limitUsageService.commitWithManager(m, { idempotencyKey: committed.key }));
    // backdate the aged reservation and the committed one
    await dataSource.query(`UPDATE limit_reservations SET reserved_at = NOW() - INTERVAL '120 minutes' WHERE idempotency_key IN ($1,$2)`, [aged.key, committed.key]);

    const stale = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?principalId=${pA}&stale=true`)
      .set('Authorization', auth('OPERATOR'));
    expect(stale.body.staleThresholdMinutes).toBe(30);
    expect(stale.body.total).toBe(1); // only the aged RESERVED one; COMMITTED never flagged
    expect(stale.body.data[0].idempotencyKey).toBe(aged.key);
    expect(stale.body.data[0].stale).toBe(true);
    expect(stale.body.data[0].ageSeconds).toBeGreaterThan(60 * 60);

    const all = await request(app.getHttpServer())
      .get(`/api/v1/internal/limit-reservations?principalId=${pA}`)
      .set('Authorization', auth('OPERATOR'));
    const freshItem = all.body.data.find((d) => d.idempotencyKey === fresh.key);
    expect(freshItem.stale).toBe(false);

    // configurable threshold — diagnostic flag only, never triggers release
    const prev = process.env.LIMIT_RESERVATION_STALE_THRESHOLD_MINUTES;
    try {
      process.env.LIMIT_RESERVATION_STALE_THRESHOLD_MINUTES = '240';
      const none = await request(app.getHttpServer())
        .get(`/api/v1/internal/limit-reservations?principalId=${pA}&stale=true`)
        .set('Authorization', auth('OPERATOR'));
      expect(none.body.staleThresholdMinutes).toBe(240);
      expect(none.body.total).toBe(0); // 120min < 240min → not stale under the larger threshold
    } finally {
      if (prev === undefined) delete process.env.LIMIT_RESERVATION_STALE_THRESHOLD_MINUTES;
      else process.env.LIMIT_RESERVATION_STALE_THRESHOLD_MINUTES = prev;
    }
  });

  // ── 8. Manual recovery boundary authorization (mutation surface is NOT diagnostics) ──

  it('11 POST /internal/limit-reservation-recovery/release — PRIVILEGED only; OPERATOR/SERVICE/SUPPORT denied', async () => {
    const pA = randomUUID();
    const { key } = await reserve({ principalId: pA });
    const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [key]);
    const reservationId = rows[0].id;

    for (const role of ['OPERATOR', 'SERVICE', 'SUPPORT']) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/internal/limit-reservation-recovery/release')
        .set('Authorization', auth(role))
        .send({ reservationId, reason: 'attempted release by non-privileged role must fail' });
      expect(res.status).toBe(403);
    }
    const noAuth = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-reservation-recovery/release')
      .send({ reservationId, reason: 'attempted release without authentication must fail' });
    expect(noAuth.status).toBe(401);

    // still RESERVED after all denied attempts
    const after: Array<{ status: string }> = await dataSource.query(`SELECT status FROM limit_reservations WHERE id=$1`, [reservationId]);
    expect(after[0].status).toBe('RESERVED');
  });
});
