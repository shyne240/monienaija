/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * V1-COMMERCIAL-DECISION-01 — Commercial Decision Snapshot FOUNDATION (real PostgreSQL).
 *
 * Foundation only: runtime wiring into the 8 financial flows is future work
 * (V1-COMMERCIAL-DECISION-02). This suite tests the foundation independently:
 *
 *  1. migration/schema: table, CHECK-validated JSONB decision sections, immutability trigger
 *  2. snapshot creation (service) — fee-free, no commission, no reward, NOT_EVALUATED limit
 *  3. approved + rejected limit decision representation incl. profile/rule/version references
 *  4. historical explainability after rule/config changes (snapshot keeps ruleIds + versions)
 *  5. DB-enforced immutability (UPDATE/DELETE raise) + corrections only as new superseding rows
 *  6. idempotency: replay same payload, 409 on different payload, unique original per reference
 *  7. concurrent creation (SERIALIZABLE retry) — exactly one row per idempotency key
 *  8. no wallet/ledger/limit-usage mutation ever
 *  9. read-only workforce API: authn/authz, safe projection (no request_hash), pagination
 *
 * No mocks of PostgreSQL; no invented fee/commission/reward rates anywhere.
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { CommercialDecisionSnapshotService } from '../src/commercial-decision/commercial-decision-snapshot.service';
import {
  commissionNone,
  feeNotConfigured,
  limitApproved,
  limitNotEvaluated,
  limitRejected,
  rewardNone,
} from '../src/commercial-decision/commercial-decision.defaults';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

describe('V1-COMMERCIAL-DECISION-01 Commercial Decision Snapshot foundation (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let service: CommercialDecisionSnapshotService;

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
    dataSource = await createIntegrationDataSource('v1-comm-dec-01');
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
    service = app.get(CommercialDecisionSnapshotService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  // ── fixtures & helpers ──

  function baseInput(overrides: Record<string, unknown> = {}) {
    const principalId = (overrides.principalId as string) ?? randomUUID();
    const currency = (overrides.currency as string) ?? 'NGN';
    const principalAmountMinor = (overrides.principalAmountMinor as string) ?? '250000';
    return {
      idempotencyKey: `comm-dec:${randomUUID()}`,
      product: 'WALLET_TRANSFER',
      direction: 'OUTGOING',
      channel: null,
      principalType: 'CUSTOMER',
      principalId,
      currency,
      principalAmountMinor,
      transactionReference: `TXN-${randomUUID().slice(0, 12)}`,
      correlationId: `corr-${randomUUID().slice(0, 8)}`,
      journalId: null,
      decisionStatus: 'FINAL' as const,
      feeDecision: feeNotConfigured(currency, principalAmountMinor),
      commissionDecision: commissionNone(),
      rewardDecision: rewardNone(),
      limitDecision: limitNotEvaluated(),
      revenueDecision: null,
      configurationVersion: 'CFG-TEST-1',
      createdBy: 'test-suite',
      ...overrides,
    };
  }

  async function rowCount(table: string): Promise<number> {
    const rows: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ${table}`);
    return Number(rows[0]!.cnt);
  }

  async function sideEffectTables(): Promise<Record<string, number>> {
    const tables = [
      'ledger_accounts',
      'ledger_journals',
      'ledger_lines',
      'wallet_accounts',
      'limit_usages',
      'limit_reservations',
      'limit_profiles',
      'limit_rules',
      'limit_assignments',
    ];
    const out: Record<string, number> = {};
    for (const t of tables) out[t] = await rowCount(t);
    return out;
  }

  async function getRow(id: string): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await dataSource.query(`SELECT * FROM commercial_decision_snapshots WHERE id=$1`, [id]);
    return rows[0]!;
  }

  // ── 1. migration & schema ──

  it('01. migration 0070 creates the table with CHECK-validated JSONB sections and the immutability trigger', async () => {
    const tables: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='commercial_decision_snapshots'`,
    );
    expect(tables).toHaveLength(1);

    const constraints: Array<{ conname: string; contype: string }> = await dataSource.query(
      `SELECT conname, contype FROM pg_constraint WHERE conrelid='commercial_decision_snapshots'::regclass ORDER BY conname`,
    );
    const names = constraints.map((c) => c.conname);
    for (const expected of [
      'chk_commercial_decision_fee_status',
      'chk_commercial_decision_commission_status',
      'chk_commercial_decision_reward_status',
      'chk_commercial_decision_limit_status',
      'chk_commercial_decision_currency',
      'chk_commercial_decision_amount',
      'chk_commercial_decision_finalized',
    ]) {
      expect(names).toContain(expected);
    }
    // FEE / COMMISSION / REWARD / LIMIT stay distinct columns — never collapsed into one "fee" blob
    const columns: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='commercial_decision_snapshots' ORDER BY column_name`,
    );
    const cols = columns.map((c) => c.column_name);
    for (const expected of ['fee_decision', 'commission_decision', 'reward_decision', 'limit_decision', 'revenue_decision']) {
      expect(cols).toContain(expected);
    }

    const triggers: Array<{ tgname: string }> = await dataSource.query(
      `SELECT tgname FROM pg_trigger WHERE tgrelid='commercial_decision_snapshots'::regclass AND NOT tgisinternal`,
    );
    expect(triggers.map((t) => t.tgname)).toContain('trg_commercial_decision_snapshots_immutable');

    const indexes: Array<{ indexname: string }> = await dataSource.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='commercial_decision_snapshots'`,
    );
    const idx = indexes.map((i) => i.indexname);
    expect(idx).toContain('uq_commercial_decision_idempotency');
    expect(idx).toContain('uq_commercial_decision_reference');
  });

  it('02. CHECK constraints reject invalid decision statuses at the database layer (validated JSONB, not opaque blob)', async () => {
    const good = baseInput();
    const created = await service.recordDecision(good);
    const row = await getRow(created.snapshot.id as string);
    expect(row.decision_status).toBe('FINAL');

    const badInsert = async (column: string, status: string) => {
      await expect(
        dataSource.query(
          `INSERT INTO commercial_decision_snapshots (idempotency_key, request_hash, product, principal_type, principal_id, currency, principal_amount_minor, transaction_reference, decision_status, finalized_at, ${column}, commission_decision, reward_decision, limit_decision, created_by)
           VALUES ($1,$2,'WALLET_TRANSFER','CUSTOMER',$3,'NGN',100,$4,'FINAL',NOW(),$5,$6,$7,$8,'test')`,
          [
            `bad:${randomUUID()}`,
            'f'.repeat(64),
            randomUUID(),
            `BAD-${randomUUID().slice(0, 8)}`,
            JSON.stringify({ status }),
            JSON.stringify(commissionNone()),
            JSON.stringify(rewardNone()),
            JSON.stringify(limitNotEvaluated()),
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    };
    await badInsert('fee_decision', 'INVENTED_RATE');
    await badInsert('fee_decision', 'APPLIED_BUT_NOT_REALLY');

    // sanity: a VALID status on the same column is accepted (the CHECK is status-specific, not blanket)
    await expect(
      dataSource.query(
        `INSERT INTO commercial_decision_snapshots (idempotency_key, request_hash, product, principal_type, principal_id, currency, principal_amount_minor, transaction_reference, decision_status, finalized_at, fee_decision, commission_decision, reward_decision, limit_decision, created_by)
         VALUES ($1,$2,'WALLET_TRANSFER','CUSTOMER',$3,'NGN',100,$4,'FINAL',NOW(),$5,$6,$7,$8,'test') RETURNING id`,
        [
          `good:${randomUUID()}`,
          'a'.repeat(64),
          randomUUID(),
          `GOOD-${randomUUID().slice(0, 8)}`,
          JSON.stringify({ status: 'NOT_CONFIGURED', feeMinor: '0' }),
          JSON.stringify(commissionNone()),
          JSON.stringify(rewardNone()),
          JSON.stringify(limitNotEvaluated()),
        ],
      ),
    ).resolves.toHaveLength(1);
  });

  // ── 2. snapshot creation — fee-free foundation ──

  it('03. records a fee-free snapshot: product, reference, principal, currency, amount persisted exactly', async () => {
    const before = await sideEffectTables();
    const input = baseInput({ product: 'CUST_FUNDING', currency: 'NGN', principalAmountMinor: '500000' });
    const result = await service.recordDecision(input);
    expect(result.replayed).toBe(false);
    const id = result.snapshot.id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const row = await getRow(id);
    expect(row.product).toBe('CUST_FUNDING');
    expect(row.transaction_reference).toBe(input.transactionReference);
    expect(row.principal_type).toBe('CUSTOMER');
    expect(row.principal_id).toBe(input.principalId);
    expect(row.currency).toBe('NGN');
    expect(String(row.principal_amount_minor)).toBe('500000');
    expect(row.direction).toBe('OUTGOING');
    expect(row.correlation_id).toBe(input.correlationId);
    expect(row.decision_status).toBe('FINAL');
    expect(row.finalized_at).not.toBeNull();
    expect(row.decided_at).not.toBeNull();
    expect(row.configuration_version).toBe('CFG-TEST-1');
    expect(row.snapshot_schema_version).toBe(1);
    expect(row.created_by).toBe('test-suite');
    expect(row.supersedes_snapshot_id).toBeNull();
    // request_hash persisted (internal fingerprint) but never exposed via API (see §09/10)
    expect(String(row.request_hash)).toMatch(/^[0-9a-f]{64}$/);

    // exactly one snapshot row; nothing else in the financial universe moved
    expect(await rowCount('commercial_decision_snapshots')).toBe(1);
    expect(await sideEffectTables()).toEqual(before);
  });

  it('04. fee decision represents the fee-free reality: NOT_CONFIGURED, feeMinor 0, no invented rates', async () => {
    const input = baseInput({ principalAmountMinor: '123456' });
    const { snapshot } = await service.recordDecision(input);
    const row = await getRow(snapshot.id as string);
    const fee = row.fee_decision as Record<string, unknown>;
    expect(fee.status).toBe('NOT_CONFIGURED');
    expect(fee.feeMinor).toBe('0');
    expect(fee.vatMinor).toBe('0');
    expect(fee.totalMinor).toBe('123456'); // total = principal: no charge added
    expect(fee.currency).toBe('NGN');
    expect(fee.ruleRefs).toEqual([]);
  });

  it('05. commission decision represents "none configured": NONE with empty allocations (no invented percentages)', async () => {
    const input = baseInput();
    const { snapshot } = await service.recordDecision(input);
    const row = await getRow(snapshot.id as string);
    const commission = row.commission_decision as Record<string, unknown>;
    expect(commission.status).toBe('NONE');
    expect(commission.allocations).toEqual([]);
    expect(commission.ruleRefs).toEqual([]);
  });

  it('06. reward decision represents "none configured": NONE with empty grants (no invented cashback)', async () => {
    const input = baseInput();
    const { snapshot } = await service.recordDecision(input);
    const row = await getRow(snapshot.id as string);
    const reward = row.reward_decision as Record<string, unknown>;
    expect(reward.status).toBe('NONE');
    expect(reward.grants).toEqual([]);
    expect(reward.ruleRefs).toEqual([]);
  });

  it('07. validation rejects malformed decisions (status closed sets, amount guards, required fields)', async () => {
    await expect(service.recordDecision(baseInput({ feeDecision: { status: 'BOGUS' } } as any))).rejects.toMatchObject({ status: 400 });
    await expect(service.recordDecision(baseInput({ commissionDecision: { status: 'ALLOCATED', allocations: [] } } as any))).rejects.toMatchObject({ status: 400 });
    await expect(service.recordDecision(baseInput({ rewardDecision: { status: 'GRANTED', grants: [] } } as any))).rejects.toMatchObject({ status: 400 });
    await expect(service.recordDecision(baseInput({ limitDecision: { status: 'REJECTED' } } as any))).rejects.toMatchObject({ status: 400 });
    await expect(service.recordDecision(baseInput({ principalAmountMinor: '-5' } as any))).rejects.toMatchObject({ status: 400 });
    await expect(service.recordDecision(baseInput({ currency: 'ngn' } as any))).rejects.toMatchObject({ status: 400 });
    await expect(service.recordDecision(baseInput({ principalType: 'AGGREGATOR' } as any))).rejects.toMatchObject({ status: 400 });
    await expect(service.recordDecision(baseInput({ idempotencyKey: '' } as any))).rejects.toMatchObject({ status: 400 });
    expect(await rowCount('commercial_decision_snapshots')).toBe(0);
  });

  // ── 3. limit decision representation (evidence, not authority) ──

  it('08. captures an APPROVED limit decision with profile/rule/version references without touching limit_usage', async () => {
    const before = await sideEffectTables();
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, version, created_by) VALUES ('CD_P1','CD Profile','CUSTOMER','ACTIVE',true,'CONFIGURED',3,'test')`,
    );
    const ruleInsert: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO limit_rules (limit_profile_code, product, dimension, currency, direction, limit_value_minor, is_active, version, created_by)
       VALUES ('CD_P1','WALLET_TRANSFER','DAILY_AMOUNT','NGN','OUTGOING',100000,true,2,'test') RETURNING id`,
    );
    const ruleId = ruleInsert[0]!.id;
    const reservationId = randomUUID();
    const usageId = randomUUID();

    const input = baseInput({
      product: 'WALLET_TRANSFER',
      limitDecision: limitApproved({
        profileCode: 'CD_P1',
        assignmentId: randomUUID(),
        ruleRefs: [{ ruleId, ruleVersion: 2, dimension: 'DAILY_AMOUNT', limitValueMinor: '100000' }],
        reservationIds: [reservationId],
        usageIds: [usageId],
      }),
    });
    const { snapshot } = await service.recordDecision(input);
    const row = await getRow(snapshot.id as string);
    const limit = row.limit_decision as Record<string, unknown>;
    expect(limit.status).toBe('APPROVED');
    expect(limit.profileCode).toBe('CD_P1');
    expect(limit.failureCode ?? null).toBeNull();
    expect(limit.ruleRefs).toEqual([{ ruleId, ruleVersion: 2, dimension: 'DAILY_AMOUNT', limitValueMinor: '100000' }]);
    expect(limit.reservationIds).toEqual([reservationId]);
    expect(limit.usageIds).toEqual([usageId]);

    // Snapshot is evidence ONLY: authoritative limit tables unchanged (except the fixture rows above)
    const after = await sideEffectTables();
    expect(after.limit_usages).toBe(before.limit_usages);
    expect(after.limit_reservations).toBe(before.limit_reservations);
    expect(after.limit_profiles).toBe(before.limit_profiles + 1); // fixture only
    expect(after.limit_rules).toBe(before.limit_rules + 1); // fixture only
    expect(after.ledger_journals).toBe(before.ledger_journals);
  });

  it('09. captures a REJECTED limit decision with failure code (and no reservation evidence)', async () => {
    const input = baseInput({
      limitDecision: limitRejected({ failureCode: 'DAILY_AMOUNT_EXCEEDED', profileCode: 'CD_P1', ruleRefs: [{ ruleId: randomUUID(), ruleVersion: 1 }] }),
    });
    const { snapshot } = await service.recordDecision(input);
    const row = await getRow(snapshot.id as string);
    const limit = row.limit_decision as Record<string, unknown>;
    expect(limit.status).toBe('REJECTED');
    expect(limit.failureCode).toBe('DAILY_AMOUNT_EXCEEDED');
    expect(limit.reservationIds).toEqual([]);
    expect(limit.usageIds).toEqual([]);
    expect(await rowCount('limit_usages')).toBe(0);
    expect(await rowCount('limit_reservations')).toBe(0);
  });

  it('10. historical explainability: snapshot keeps rule IDs + versions after the rule is changed later', async () => {
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, version, created_by) VALUES ('CD_P2','CD Profile 2','CUSTOMER','ACTIVE',true,'CONFIGURED',1,'test')`,
    );
    const ruleInsert: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO limit_rules (limit_profile_code, product, dimension, currency, direction, limit_value_minor, is_active, version, created_by)
       VALUES ('CD_P2','WALLET_TRANSFER','DAILY_AMOUNT','NGN','OUTGOING',50000,true,1,'test') RETURNING id`,
    );
    const ruleId = ruleInsert[0]!.id;

    const input = baseInput({
      configurationVersion: 'CFG-V1',
      limitDecision: limitApproved({ profileCode: 'CD_P2', ruleRefs: [{ ruleId, ruleVersion: 1, limitValueMinor: '50000' }] }),
    });
    const { snapshot } = await service.recordDecision(input);
    const snapshotId = snapshot.id as string;

    // Admin changes the rule (version bump + new value) and the commercial configuration version
    await dataSource.query(`UPDATE limit_rules SET limit_value_minor=75000, version=2 WHERE id=$1`, [ruleId]);

    const input2 = baseInput({
      configurationVersion: 'CFG-V2',
      limitDecision: limitApproved({ profileCode: 'CD_P2', ruleRefs: [{ ruleId, ruleVersion: 2, limitValueMinor: '75000' }] }),
    });
    await service.recordDecision(input2);

    // Historical snapshot is frozen at decision time — no lookup of "current" rule state needed
    const row = await getRow(snapshotId);
    const limit = row.limit_decision as Record<string, unknown>;
    expect(row.configuration_version).toBe('CFG-V1');
    expect(limit.ruleRefs).toEqual([{ ruleId, ruleVersion: 1, limitValueMinor: '50000' }]);
    const currentRule: Array<{ version: number; limit_value_minor: string }> = await dataSource.query(
      `SELECT version, limit_value_minor::text AS limit_value_minor FROM limit_rules WHERE id=$1`,
      [ruleId],
    );
    expect(currentRule[0]!.version).toBe(2);
    expect(String(currentRule[0]!.limit_value_minor)).toBe('75000');
  });

  // ── 4. immutability & corrections ──

  it('11. rows are immutable at the database layer: UPDATE and DELETE raise, rows unchanged', async () => {
    const { snapshot } = await service.recordDecision(baseInput());
    const id = snapshot.id as string;
    const original = await getRow(id);

    await expect(dataSource.query(`UPDATE commercial_decision_snapshots SET principal_amount_minor=1 WHERE id=$1`, [id])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );
    await expect(dataSource.query(`UPDATE commercial_decision_snapshots SET fee_decision='{"status":"APPLIED"}'::jsonb WHERE id=$1`, [id])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );
    await expect(dataSource.query(`DELETE FROM commercial_decision_snapshots WHERE id=$1`, [id])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );

    const after = await getRow(id);
    expect(String(after.principal_amount_minor)).toBe(String(original.principal_amount_minor));
    expect(after.fee_decision).toEqual(original.fee_decision);
    expect(await rowCount('commercial_decision_snapshots')).toBe(1);
  });

  it('12. corrections are NEW compensating rows via supersedes_snapshot_id — original untouched; reason required', async () => {
    const original = await service.recordDecision(baseInput({ transactionReference: 'TXN-CORR-1' }));
    const originalId = original.snapshot.id as string;

    await expect(
      service.recordDecision(baseInput({ transactionReference: 'TXN-CORR-1', supersedesSnapshotId: originalId } as any)),
    ).rejects.toMatchObject({ status: 400 }); // reason required

    const correction = await service.recordDecision(
      baseInput({
        transactionReference: 'TXN-CORR-1',
        supersedesSnapshotId: originalId,
        supersededReason: 'Wrong principal captured at decision time; compensating record',
      } as any),
    );
    expect(correction.replayed).toBe(false);
    expect(correction.snapshot.id).not.toBe(originalId);
    const corrRow = await getRow(correction.snapshot.id as string);
    expect(corrRow.supersedes_snapshot_id).toBe(originalId);
    expect(corrRow.superseded_reason).toBe('Wrong principal captured at decision time; compensating record');

    // original still immutable and present
    const origRow = await getRow(originalId);
    expect(origRow.supersedes_snapshot_id).toBeNull();
    expect(await rowCount('commercial_decision_snapshots')).toBe(2);

    // "current decision" for the reference is the latest recorded row (the correction)
    const current = await service.findByReference('WALLET_TRANSFER', 'TXN-CORR-1');
    expect(current!.id).toBe(correction.snapshot.id);
    // original retrievable by id for audit
    const byId = await service.findById(originalId);
    expect(byId.id).toBe(originalId);
  });

  it('13. service exposes no mutating API surface (write-once foundation)', async () => {
    const proto = Object.getPrototypeOf(service) as Record<string, unknown>;
    const methodNames = Object.getOwnPropertyNames(proto).filter((n) => typeof proto[n] === 'function');
    for (const bad of ['update', 'remove', 'delete', 'softDelete', 'restore', 'patch', 'modify']) {
      expect(methodNames.some((n) => n.toLowerCase().startsWith(bad))).toBe(false);
    }
    expect(methodNames).toContain('recordDecision');
    expect(methodNames).toContain('recordDecisionWithManager');
    expect(methodNames).toContain('findById');
    expect(methodNames).toContain('findByReference');
    expect(methodNames).toContain('list');
  });

  // ── 5. idempotency & duplicates ──

  it('14. duplicate creation with identical payload replays: same row, replayed=true, still one row', async () => {
    const input = baseInput();
    const first = await service.recordDecision(input);
    const second = await service.recordDecision({ ...input });
    const third = await service.recordDecision({ ...input, createdBy: 'test-suite' }); // identical canonical payload
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(third.replayed).toBe(true);
    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect(third.snapshot.id).toBe(first.snapshot.id);
    expect(await rowCount('commercial_decision_snapshots')).toBe(1);
  });

  it('15. same idempotency key with a different decision payload is rejected with 409 (no silent overwrite)', async () => {
    const input = baseInput({ principalAmountMinor: '100000' });
    await service.recordDecision(input);
    await expect(service.recordDecision({ ...input, principalAmountMinor: '999999' })).rejects.toMatchObject({ status: 409 });
    await expect(service.recordDecision({ ...input, feeDecision: feeNotConfigured('NGN', '999999') })).rejects.toMatchObject({ status: 409 });
    expect(await rowCount('commercial_decision_snapshots')).toBe(1);
    const rows: Array<{ principal_amount_minor: string }> = await dataSource.query(`SELECT principal_amount_minor::text FROM commercial_decision_snapshots`);
    expect(rows[0]!.principal_amount_minor).toBe('100000');
  });

  it('16. a second ORIGINAL snapshot for the same product+reference conflicts (unique association)', async () => {
    await service.recordDecision(baseInput({ transactionReference: 'TXN-UNIQ-1' }));
    await expect(service.recordDecision(baseInput({ transactionReference: 'TXN-UNIQ-1' }))).rejects.toMatchObject({ status: 409 });
    // different reference is fine
    await service.recordDecision(baseInput({ transactionReference: 'TXN-UNIQ-2' }));
    // same reference under a different product is also a distinct association
    await service.recordDecision(baseInput({ transactionReference: 'TXN-UNIQ-1', product: 'AGENT_FUNDING' }));
    expect(await rowCount('commercial_decision_snapshots')).toBe(3);
  });

  it('17. concurrent creation with the same idempotency key produces exactly one row (SERIALIZABLE retry)', async () => {
    const input = baseInput();
    const attempts = Array.from({ length: 6 }, () => service.recordDecision({ ...input }));
    const results = await Promise.all(attempts);
    const ids = new Set(results.map((r) => r.snapshot.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await rowCount('commercial_decision_snapshots')).toBe(1);
  }, 70000);

  it('18. concurrent creation with distinct keys creates all rows (no lost writes)', async () => {
    const inputs = Array.from({ length: 5 }, () => baseInput());
    await Promise.all(inputs.map((i) => service.recordDecision(i)));
    expect(await rowCount('commercial_decision_snapshots')).toBe(5);
  }, 70000);

  // ── 6. recordDecisionWithManager joins an external SERIALIZABLE boundary ──

  it('19. recordDecisionWithManager writes inside a caller-managed SERIALIZABLE transaction (future in-flow wiring point)', async () => {
    const before = await sideEffectTables();
    const input = baseInput({ transactionReference: 'TXN-MGR-1' });
    const result = await dataSource.transaction('SERIALIZABLE', (manager) => service.recordDecisionWithManager(manager, input));
    expect(result.replayed).toBe(false);
    expect(await rowCount('commercial_decision_snapshots')).toBe(1);

    // replay path also works inside a managed transaction
    const replay = await dataSource.transaction('SERIALIZABLE', (manager) => service.recordDecisionWithManager(manager, { ...input }));
    expect(replay.replayed).toBe(true);
    expect(replay.snapshot.id).toBe(result.snapshot.id);

    // a rolled-back boundary never persists a snapshot (atomicity with future flow writes)
    await expect(
      dataSource.transaction('SERIALIZABLE', async (manager) => {
        await service.recordDecisionWithManager(manager, baseInput({ transactionReference: 'TXN-MGR-ROLLBACK' }));
        throw new Error('simulated flow failure');
      }),
    ).rejects.toThrow('simulated flow failure');
    expect(await rowCount('commercial_decision_snapshots')).toBe(1);
    expect(await sideEffectTables()).toEqual(before);
  });

  // ── 7. no financial side effects ──

  it('20. snapshot recording never mutates wallets, ledger or limit usage (diff of all financial tables)', async () => {
    const before = await sideEffectTables();
    for (let i = 0; i < 3; i += 1) {
      await service.recordDecision(
        baseInput({
          limitDecision: limitApproved({ profileCode: 'CD_X', ruleRefs: [{ ruleId: randomUUID(), ruleVersion: 1 }], reservationIds: [randomUUID()] }),
        }),
      );
    }
    const after = await sideEffectTables();
    expect(after).toEqual(before);
    expect(await rowCount('commercial_decision_snapshots')).toBe(3);
  });

  // ── 8. read-only workforce API ──

  async function seedForApi(): Promise<{ id: string; product: string; reference: string; principalId: string }> {
    const principalId = randomUUID();
    const input = baseInput({ product: 'WALLET_TRANSFER', principalId, transactionReference: 'TXN-API-1' });
    const { snapshot } = await service.recordDecision(input);
    return { id: snapshot.id as string, product: 'WALLET_TRANSFER', reference: 'TXN-API-1', principalId };
  }

  it('21. unauthenticated list/get → 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/internal/commercial-decision-snapshots').expect(401);
    await request(app.getHttpServer()).get(`/api/v1/internal/commercial-decision-snapshots/${randomUUID()}`).expect(401);
  });

  it('22. non-workforce principals denied (CUSTOMER, AGENT, AGGREGATOR, SUPPORT)', async () => {
    for (const type of ['CUSTOMER', 'AGENT', 'AGGREGATOR', 'SUPPORT']) {
      await request(app.getHttpServer()).get('/api/v1/internal/commercial-decision-snapshots').set('Authorization', auth(type)).expect(403);
      await request(app.getHttpServer())
        .get(`/api/v1/internal/commercial-decision-snapshots/${randomUUID()}`)
        .set('Authorization', auth(type))
        .expect(403);
    }
  });

  it('23. workforce roles can read: OPERATOR/SERVICE/PRIVILEGED all authorized', async () => {
    const { id } = await seedForApi();
    for (const type of ['OPERATOR', 'SERVICE', 'PRIVILEGED']) {
      const list = await request(app.getHttpServer())
        .get('/api/v1/internal/commercial-decision-snapshots')
        .set('Authorization', auth(type))
        .expect(200);
      expect(list.body.total).toBeGreaterThanOrEqual(1);
      const one = await request(app.getHttpServer())
        .get(`/api/v1/internal/commercial-decision-snapshots/${id}`)
        .set('Authorization', auth(type))
        .expect(200);
      expect(one.body.id).toBe(id);
    }
  });

  it('24. safe projection: request_hash never exposed; decision sections and operational evidence present', async () => {
    const { id } = await seedForApi();
    const list = await request(app.getHttpServer())
      .get('/api/v1/internal/commercial-decision-snapshots')
      .set('Authorization', auth('OPERATOR'))
      .expect(200);
    const single = await request(app.getHttpServer())
      .get(`/api/v1/internal/commercial-decision-snapshots/${id}`)
      .set('Authorization', auth('OPERATOR'))
      .expect(200);

    for (const body of [JSON.stringify(list.body), JSON.stringify(single.body)]) {
      expect(body).not.toContain('request_hash');
      expect(body).not.toContain('requestHash');
      // no secrets surface exists in the schema at all
      for (const forbidden of ['password', 'pin', 'otp', 'secret', 'token']) {
        expect(body.toLowerCase()).not.toContain(forbidden);
      }
    }
    const item = single.body;
    expect(item.product).toBe('WALLET_TRANSFER');
    expect(item.currency).toBe('NGN');
    expect(String(item.principal_amount_minor)).toBe('250000');
    expect(item.fee_decision.status).toBe('NOT_CONFIGURED');
    expect(item.commission_decision.status).toBe('NONE');
    expect(item.reward_decision.status).toBe('NONE');
    expect(item.limit_decision.status).toBe('NOT_EVALUATED');
  });

  it('25. deterministic pagination + filters', async () => {
    const principalId = randomUUID();
    for (let i = 0; i < 5; i += 1) {
      await service.recordDecision(
        baseInput({ product: i % 2 === 0 ? 'WALLET_TRANSFER' : 'CUST_FUNDING', principalId, decidedAt: new Date(Date.now() + i * 1000).toISOString() }),
      );
    }
    const page1 = await request(app.getHttpServer())
      .get('/api/v1/internal/commercial-decision-snapshots?page=1&limit=2')
      .set('Authorization', auth('OPERATOR'))
      .expect(200);
    expect(page1.body.page).toBe(1);
    expect(page1.body.limit).toBe(2);
    expect(page1.body.total).toBe(5);
    expect(page1.body.totalPages).toBe(3);
    expect(page1.body.data).toHaveLength(2);

    const page2 = await request(app.getHttpServer())
      .get('/api/v1/internal/commercial-decision-snapshots?page=2&limit=2')
      .set('Authorization', auth('OPERATOR'))
      .expect(200);
    expect(page2.body.data).toHaveLength(2);
    const ids1 = page1.body.data.map((d: any) => d.id);
    const ids2 = page2.body.data.map((d: any) => d.id);
    expect(ids2.every((id: string) => !ids1.includes(id))).toBe(true);

    // decided_at DESC deterministic ordering
    const decidedAts = page1.body.data.map((d: any) => new Date(d.decided_at).getTime());
    expect(decidedAts[0]).toBeGreaterThanOrEqual(decidedAts[1]);

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/internal/commercial-decision-snapshots?product=CUST_FUNDING')
      .set('Authorization', auth('OPERATOR'))
      .expect(200);
    expect(filtered.body.total).toBe(2);
    expect(filtered.body.data.every((d: any) => d.product === 'CUST_FUNDING')).toBe(true);

    const byPrincipal = await request(app.getHttpServer())
      .get(`/api/v1/internal/commercial-decision-snapshots?principalId=${principalId}`)
      .set('Authorization', auth('OPERATOR'))
      .expect(200);
    expect(byPrincipal.body.total).toBe(5);

    await request(app.getHttpServer()).get('/api/v1/internal/commercial-decision-snapshots?limit=0').set('Authorization', auth('OPERATOR')).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/commercial-decision-snapshots?page=0').set('Authorization', auth('OPERATOR')).expect(400);
  });

  it('26. get-by-id validation and 404; the surface is read-only (no POST/PATCH/DELETE routes)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/internal/commercial-decision-snapshots/not-a-uuid')
      .set('Authorization', auth('OPERATOR'))
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/internal/commercial-decision-snapshots/${randomUUID()}`)
      .set('Authorization', auth('OPERATOR'))
      .expect(404);

    // read-only: no mutating routes exist
    await request(app.getHttpServer())
      .post('/api/v1/internal/commercial-decision-snapshots')
      .set('Authorization', auth('PRIVILEGED'))
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/internal/commercial-decision-snapshots/${randomUUID()}`)
      .set('Authorization', auth('PRIVILEGED'))
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/internal/commercial-decision-snapshots/${randomUUID()}`)
      .set('Authorization', auth('PRIVILEGED'))
      .expect(404);
  });

  it('27. runtime wiring boundary is honored: foundation records decisions but 8 financial flows stay untouched', async () => {
    // This suite intentionally exercises the foundation in isolation. Wiring into the flows is
    // V1-COMMERCIAL-DECISION-02; nothing in this task changes fee-free financial behavior.
    const source = readFileSync(join(__dirname, '../src/commercial-decision/commercial-decision-snapshot.service.ts'), 'utf8');
    expect(source).not.toContain('TransferService');
    expect(source).not.toContain('CustomerFundingService');
    expect(source).not.toContain('AgentFundingService');
    expect(source).not.toContain('LedgerService');
    expect(source).not.toContain('WalletService');
    expect(source).not.toContain('DELETE FROM');
    expect(source).not.toContain('UPDATE commercial_decision_snapshots');
  });
});
