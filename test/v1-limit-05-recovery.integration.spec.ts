/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * V1-LIMIT-05 — PART 3: safe reservation recovery boundary (manual only — automatic reaping BLOCKED).
 *
 * Verified here:
 *   - RESERVED → RELEASED manual release decrements reserved counters exactly once, audited
 *   - COMMITTED reservations are immutable (409), RELEASED acknowledgements are idempotent
 *   - concurrent releases: exactly one performs the release (SELECT ... FOR UPDATE), no double decrement
 *   - RELEASED-only transition; no DELETE; no historical rewrite; no financial ledger mutation
 *   - validation (UUID, reason, 404) and PRIVILEGED-only authorization over HTTP
 *   - released allowance becomes available again (no permanent consumption by failed work)
 *
 * WHY NO AUTOMATIC REAPER: reservation lifecycle is atomic inside each flow's SERIALIZABLE
 * transaction (reserve→commit/release alongside ledger posting); no background financial
 * processor exists; no authoritative cross-product correlation-terminal-state exists to prove
 * orphaning. Stale age alone is never sufficient. See docs/V1-LIMIT-05-VERIFICATION-REPORT.md.
 *
 * Real PostgreSQL; no mocks of the recovery path.
 */
import { ValidationPipe, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
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
import { LimitReservationRecoveryService } from '../src/limit-catalog/limit-reservation-recovery.service';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

describe('V1-LIMIT-05 Reservation Recovery Boundary (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let limitUsageService: LimitUsageService;
  let recoveryService: LimitReservationRecoveryService;

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
    dataSource = await createIntegrationDataSource('v1-limit-05-rec');
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
    recoveryService = app.get(LimitReservationRecoveryService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await dataSource.query(`INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ('REC_PROFILE', 'Recovery Profile', 'CUSTOMER', 'ACTIVE', true, 'CONFIGURED', 'test')`);
  });

  async function reserve(principalId: string, key?: string, amount = '10000', dimension = 'DAILY_AMOUNT'): Promise<{ key: string; reservationId: string; usageId: string }> {
    const idemKey = key ?? `rec-${randomUUID()}`;
    const isCount = dimension.endsWith('_COUNT');
    const result = await limitUsageService.reserveBatch({
      principalType: 'CUSTOMER',
      principalId,
      limitProfileCode: 'REC_PROFILE',
      product: 'WALLET_TRANSFER',
      currency: 'NGN',
      direction: 'OUTGOING',
      channel: null,
      reservations: [
        {
          dimension,
          product: 'WALLET_TRANSFER',
          currency: 'NGN',
          amountMinor: isCount ? null : amount,
          count: isCount ? 1 : null,
          direction: 'OUTGOING',
        },
      ],
      idempotencyKey: idemKey,
      requestHash: createHash('sha256').update(idemKey).digest('hex'),
      correlationId: `rec-corr-${randomUUID().slice(0, 8)}`,
    });
    const reservation = result.reservations[0];
    return { key: idemKey, reservationId: reservation.id, usageId: reservation.limitUsageId };
  }

  async function getCounters(usageId: string): Promise<{ reserved: string; used: string; reservedCount: number; usedCount: number }> {
    const rows: Array<{ reserved_amount_minor: string; used_amount_minor: string; reserved_count: number; used_count: number }> = await dataSource.query(
      `SELECT reserved_amount_minor::text AS reserved_amount_minor, used_amount_minor::text AS used_amount_minor, reserved_count, used_count FROM limit_usages WHERE id=$1`,
      [usageId],
    );
    return { reserved: rows[0].reserved_amount_minor, used: rows[0].used_amount_minor, reservedCount: rows[0].reserved_count, usedCount: rows[0].used_count };
  }

  it('01 manual release of RESERVED — RELEASED-only transition, counters decremented once, audited', async () => {
    const principalId = randomUUID();
    const { reservationId, usageId } = await reserve(principalId);
    const before = await getCounters(usageId);
    expect(before.reserved).toBe('10000');

    const result = await recoveryService.releaseManually({
      reservationId,
      actor: 'workforce-privileged-1',
      reason: 'Investigated via diagnostics — correlated transfer never posted; manual recovery',
    });
    expect(result.outcome).toBe('RELEASED');
    expect(result.status).toBe('RELEASED');
    expect(result.auditEventId).toBeTruthy();

    const rows: Array<{ status: string; released_at: string | null }> = await dataSource.query(`SELECT status, released_at FROM limit_reservations WHERE id=$1`, [reservationId]);
    expect(rows[0].status).toBe('RELEASED');
    expect(rows[0].released_at).toBeTruthy();

    const after = await getCounters(usageId);
    expect(after.reserved).toBe('0');
    expect(after.used).toBe('0'); // release never converts to used

    const audit: Array<{ entity_type: string; entity_id: string; action: string; actor: string; new_values: any }> = await dataSource.query(
      `SELECT entity_type, entity_id, action, actor, new_values FROM audit_events WHERE id=$1`,
      [result.auditEventId],
    );
    expect(audit[0].entity_type).toBe('limit_reservation');
    expect(audit[0].entity_id).toBe(reservationId);
    expect(audit[0].action).toBe('MANUAL_RELEASE');
    expect(audit[0].actor).toBe('workforce-privileged-1');
    expect(JSON.stringify(audit[0].new_values)).toContain('manual recovery');
  });

  it('02 COMMITTED reservations are immutable — release refused with 409', async () => {
    const principalId = randomUUID();
    const { key, reservationId, usageId } = await reserve(principalId);
    await dataSource.transaction('SERIALIZABLE', (m) => limitUsageService.commitWithManager(m, { idempotencyKey: key }));
    const before = await getCounters(usageId);
    expect(before.used).toBe('10000');

    await expect(
      recoveryService.releaseManually({ reservationId, actor: 'workforce-privileged-1', reason: 'attempt to release a COMMITTED reservation must be refused' }),
    ).rejects.toThrow(ConflictException);

    const rows: Array<{ status: string }> = await dataSource.query(`SELECT status FROM limit_reservations WHERE id=$1`, [reservationId]);
    expect(rows[0].status).toBe('COMMITTED');
    const after = await getCounters(usageId);
    expect(after.used).toBe('10000'); // untouched
    expect(after.reserved).toBe('0');
  });

  it('03 RELEASED replay is idempotent — no double decrement', async () => {
    const principalId = randomUUID();
    const { reservationId, usageId } = await reserve(principalId);
    const first = await recoveryService.releaseManually({ reservationId, actor: 'workforce-privileged-1', reason: 'first manual release of the reservation' });
    expect(first.outcome).toBe('RELEASED');
    const second = await recoveryService.releaseManually({ reservationId, actor: 'workforce-privileged-1', reason: 'second manual release must be acknowledged idempotently' });
    expect(second.outcome).toBe('ALREADY_RELEASED');
    const after = await getCounters(usageId);
    expect(after.reserved).toBe('0'); // decremented exactly once, not twice (no underflow)
    const audits: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text AS cnt FROM audit_events WHERE entity_type='limit_reservation' AND entity_id=$1 AND action='MANUAL_RELEASE'`,
      [reservationId],
    );
    expect(audits[0].cnt).toBe('1');
  });

  it('04 concurrent manual releases — exactly one releases, counters decremented exactly once', async () => {
    const principalId = randomUUID();
    const { reservationId, usageId } = await reserve(principalId);
    const reason = 'concurrent manual release race — only one must win';
    const results = await Promise.all([
      recoveryService.releaseManually({ reservationId, actor: 'workforce-privileged-1', reason }).catch((e) => e),
      recoveryService.releaseManually({ reservationId, actor: 'workforce-privileged-2', reason }).catch((e) => e),
      recoveryService.releaseManually({ reservationId, actor: 'workforce-privileged-3', reason }).catch((e) => e),
    ]);
    const outcomes = results.map((r) => (r instanceof Error ? `ERROR:${r.constructor.name}` : r.outcome)).sort();
    // All three must land safely: one RELEASED, the others ALREADY_RELEASED (or retryable serialization resolved)
    expect(outcomes.filter((o) => o === 'RELEASED').length).toBe(1);
    for (const o of outcomes) expect(['RELEASED', 'ALREADY_RELEASED']).toContain(o);
    const after = await getCounters(usageId);
    expect(after.reserved).toBe('0'); // exactly one decrement
    const audits: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text AS cnt FROM audit_events WHERE entity_type='limit_reservation' AND entity_id=$1 AND action='MANUAL_RELEASE'`,
      [reservationId],
    );
    expect(audits[0].cnt).toBe('1');
  });

  it('05 validation — bad UUID 400, missing/short reason 400, unknown reservation 404', async () => {
    await expect(recoveryService.releaseManually({ reservationId: 'not-a-uuid', actor: 'a', reason: 'a perfectly valid long reason' })).rejects.toThrow(BadRequestException);
    const principalId = randomUUID();
    const { reservationId } = await reserve(principalId);
    await expect(recoveryService.releaseManually({ reservationId, actor: 'a', reason: 'short' })).rejects.toThrow(BadRequestException);
    await expect(recoveryService.releaseManually({ reservationId, actor: '', reason: 'a perfectly valid long reason' })).rejects.toThrow(BadRequestException);
    await expect(recoveryService.releaseManually({ reservationId: randomUUID(), actor: 'a', reason: 'a perfectly valid long reason' })).rejects.toThrow(NotFoundException);
    // validation failures must not have mutated anything
    const rows: Array<{ status: string }> = await dataSource.query(`SELECT status FROM limit_reservations WHERE id=$1`, [reservationId]);
    expect(rows[0].status).toBe('RESERVED');
  });

  it('06 no financial ledger mutation and no DELETE — release touches only reservation+usage', async () => {
    const principalId = randomUUID();
    const { reservationId } = await reserve(principalId);
    const before = await dataSource.query(`SELECT (SELECT count(*) FROM ledger_lines)::text AS l, (SELECT count(*) FROM ledger_journals)::text AS j, (SELECT count(*) FROM limit_reservations)::text AS r`);
    await recoveryService.releaseManually({ reservationId, actor: 'workforce-privileged-1', reason: 'release with ledger-immutability verification' });
    const after = await dataSource.query(`SELECT (SELECT count(*) FROM ledger_lines)::text AS l, (SELECT count(*) FROM ledger_journals)::text AS j, (SELECT count(*) FROM limit_reservations)::text AS r`);
    expect(after).toEqual(before); // row still present (RELEASED, never deleted)
    const rows: Array<{ status: string }> = await dataSource.query(`SELECT status FROM limit_reservations WHERE id=$1`, [reservationId]);
    expect(rows[0].status).toBe('RELEASED');
  });

  it('07 released allowance becomes available again — no permanent consumption by abandoned work', async () => {
    const principalId = randomUUID();
    const first = await reserve(principalId, undefined, '90000');
    // release it (simulating operator recovery of an orphan investigated via diagnostics)
    await recoveryService.releaseManually({ reservationId: first.reservationId, actor: 'workforce-privileged-1', reason: 'recovered abandoned reservation to restore allowance' });
    // the same principal can now reserve the full amount again within the same window
    const second = await reserve(principalId, undefined, '90000');
    const counters = await getCounters(second.usageId);
    expect(counters.reserved).toBe('90000');
  });

  it('08 HTTP boundary — PRIVILEGED release succeeds; OPERATOR 403; missing reason 400', async () => {
    const principalId = randomUUID();
    const { reservationId } = await reserve(principalId);

    const noReason = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-reservation-recovery/release')
      .set('Authorization', auth('PRIVILEGED'))
      .send({ reservationId });
    expect(noReason.status).toBe(400);

    const operator = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-reservation-recovery/release')
      .set('Authorization', auth('OPERATOR'))
      .send({ reservationId, reason: 'operator attempting manual release must be denied by role check' });
    expect(operator.status).toBe(403);

    const ok = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-reservation-recovery/release')
      .set('Authorization', auth('PRIVILEGED'))
      .send({ reservationId, reason: 'privileged manual release through the HTTP boundary' });
    expect(ok.status).toBe(201);
    expect(ok.body.outcome).toBe('RELEASED');
    expect(ok.body.reservationId).toBe(reservationId);

    const rows: Array<{ status: string }> = await dataSource.query(`SELECT status FROM limit_reservations WHERE id=$1`, [reservationId]);
    expect(rows[0].status).toBe('RELEASED');
  });

  it('09 automatic-reaping guard — stale RESERVED rows are NEVER auto-released by any component', async () => {
    // This is the core financial-safety guarantee of V1-LIMIT-05 PART 3: there is no reaper.
    // Age a RESERVED reservation far beyond any threshold and run every diagnostics query —
    // it must remain RESERVED with counters untouched.
    const principalId = randomUUID();
    const { reservationId, usageId } = await reserve(principalId);
    await dataSource.query(`UPDATE limit_reservations SET reserved_at = NOW() - INTERVAL '7 days' WHERE id=$1`, [reservationId]);

    await request(app.getHttpServer()).get(`/api/v1/internal/limit-reservations?stale=true`).set('Authorization', auth('OPERATOR'));
    await request(app.getHttpServer()).get(`/api/v1/internal/limit-reservations?principalId=${principalId}`).set('Authorization', auth('PRIVILEGED'));
    await request(app.getHttpServer()).get(`/api/v1/internal/limit-usages?principalId=${principalId}`).set('Authorization', auth('SERVICE'));

    const rows: Array<{ status: string }> = await dataSource.query(`SELECT status FROM limit_reservations WHERE id=$1`, [reservationId]);
    expect(rows[0].status).toBe('RESERVED'); // still reserved — stale age alone never triggers release
    const counters = await getCounters(usageId);
    expect(counters.reserved).toBe('10000');
  });
});
