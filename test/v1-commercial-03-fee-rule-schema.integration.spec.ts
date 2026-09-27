/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * V1-COMMERCIAL-03 — Fee Rule SCHEMA foundation (real PostgreSQL).
 *
 * SCHEMA + ADMINISTRATION ONLY. Verified here:
 *   - migration 0072: fee_rules table, product FK → products.code, CHECK integrity invariants
 *   - DB-layer rejection of: negative money/bps, bps > 10000, min > max, incoherent effective
 *     dates, parameter-less rules, unknown product codes
 *   - valid creation for every non-tiered pricing model (ZERO/FREE, FLAT, PCT, PCT+MIN, PCT+MAX,
 *     PCT+MIN+MAX, FLAT+PCT) — synthetic test values only, NEVER seeded production policy
 *   - FeeEngine compatibility: stored parameters drive FeeEngine.calculate unchanged
 *   - identity uniqueness (product_code + currency + effective_from), duplicate 409
 *   - version behavior: optimistic locking, stale-version 409, concurrent single-winner
 *   - workforce authorization, safe projection, administrative audit
 *   - ZERO production rules seeded; products stay NOT_CONFIGURED
 *   - no mutation of wallets / ledger / limit usages / reservations / commercial snapshots
 *   - snapshot historical safety: rule updates never rewrite immutable snapshots
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
import { FeeEngine } from '../src/fee/fee.engine';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import {
  commissionNone,
  feeNotConfigured,
  limitNotEvaluated,
  rewardNone,
} from '../src/commercial-decision/commercial-decision.defaults';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

describe('V1-COMMERCIAL-03 Fee Rule Schema foundation (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let service: FeeRuleRegistryService;
  let snapshotService: CommercialDecisionSnapshotService;
  let feeEngine: FeeEngine;

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
    dataSource = await createIntegrationDataSource('v1-comm-03');
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
    service = app.get(FeeRuleRegistryService);
    snapshotService = app.get(CommercialDecisionSnapshotService);
    feeEngine = app.get(FeeEngine);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    // seedIfEmpty (not reseed): products is already empty after the CASCADE truncate, and
    // reseed()'s plain TRUNCATE would trip the new fee_rules → products FK
    await app.get(ProductCatalogSeedService).seedIfEmpty();
  });

  // synthetic TEST values only — never seeded production policy
  function baseRule(overrides: Record<string, unknown> = {}) {
    return {
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      flatFeeMinor: '0',
      percentageBps: null,
      minimumFeeMinor: null,
      maximumFeeMinor: null,
      vatBps: null,
      priority: 0,
      isActive: true,
      ...overrides,
    };
  }

  async function rowCount(table: string): Promise<number> {
    const rows: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ${table}`);
    return Number(rows[0]!.cnt);
  }

  async function financialTables(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of ['ledger_accounts', 'ledger_journals', 'ledger_lines', 'wallet_accounts', 'limit_usages', 'limit_reservations', 'commercial_decision_snapshots']) {
      out[t] = await rowCount(t);
    }
    return out;
  }

  // ── 1. migration & DB-layer integrity ──

  it('01. migration 0072 creates fee_rules with product FK, CHECK invariants and identity uniqueness', async () => {
    const tables: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='fee_rules'`,
    );
    expect(tables).toHaveLength(1);

    const constraints: Array<{ conname: string; contype: string }> = await dataSource.query(
      `SELECT conname, contype FROM pg_constraint WHERE conrelid='fee_rules'::regclass ORDER BY conname`,
    );
    const names = constraints.map((c) => c.conname);
    for (const expected of [
      'chk_fee_rules_currency', 'chk_fee_rules_flat', 'chk_fee_rules_percentage', 'chk_fee_rules_minimum',
      'chk_fee_rules_maximum', 'chk_fee_rules_vat', 'chk_fee_rules_effective', 'chk_fee_rules_version',
      'chk_fee_rules_params', 'chk_fee_rules_min_max',
    ]) {
      expect(names).toContain(expected);
    }
    // product_code FK → products.code
    const fks: Array<{ conname: string; confrelid: string }> = await dataSource.query(
      `SELECT conname, confrelid::regclass::text AS confrelid FROM pg_constraint WHERE conrelid='fee_rules'::regclass AND contype='f'`,
    );
    expect(fks).toHaveLength(1);
    expect(fks[0]!.confrelid).toBe('products');

    const indexes: Array<{ indexname: string }> = await dataSource.query(`SELECT indexname FROM pg_indexes WHERE tablename='fee_rules'`);
    const idx = indexes.map((i) => i.indexname);
    expect(idx).toContain('uq_fee_rules_identity');
    expect(idx).toContain('idx_fee_rules_product');

    // DB-layer rejection of invalid rows (bypassing the service):
    const product = 'WALLET_TRANSFER';
    const bad = async (cols: string, values: unknown[], code = '23514') => {
      await expect(
        dataSource.query(
          `INSERT INTO fee_rules (product_code, currency, created_by, ${cols}) VALUES ($1,'NGN','test',${values.map((_, i) => `$${i + 2}`).join(',')})`,
          [product, ...values],
        ),
      ).rejects.toMatchObject({ code });
    };
    await bad('flat_fee_minor', [-1]); // negative money
    await bad('percentage_bps', [-5]); // negative bps
    await bad('percentage_bps', [10001]); // beyond 100% — BASIS_POINTS convention from FeeEngine
    await bad('vat_bps', [10001]);
    await bad('minimum_fee_minor, maximum_fee_minor, flat_fee_minor', [500, 100, 0]); // min > max
    await bad('effective_from, effective_to', [new Date(), new Date(Date.now() - 1000)]); // incoherent window
    await bad('flat_fee_minor, percentage_bps', [null, null]); // parameter-less rule
    // unknown product → FK violation
    await expect(
      dataSource.query(`INSERT INTO fee_rules (product_code, currency, flat_fee_minor, created_by) VALUES ('NOT_A_PRODUCT','NGN',0,'test')`),
    ).rejects.toMatchObject({ code: '23503' });
    // lowercase currency rejected
    await expect(
      dataSource.query(`INSERT INTO fee_rules (product_code, currency, flat_fee_minor, created_by) VALUES ($1,'ngn',0,'test')`, [product]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  // ── 2. zero seeded rules & product catalogue unaffected ──

  it('02. ZERO production fee rules are seeded and products stay NOT_CONFIGURED', async () => {
    expect(await rowCount('fee_rules')).toBe(0);
    const products: Array<{ code: string; configuration_status: string; enabled: boolean }> = await dataSource.query(
      `SELECT code, configuration_status, enabled FROM products ORDER BY code`,
    );
    expect(products).toHaveLength(7);
    for (const p of products) {
      expect(p.configuration_status).toBe('NOT_CONFIGURED'); // fee-rule table existing changes nothing
    }
    // bootstrapping again never invents rules
    const list = await service.listRules({});
    expect(list.total).toBe(0);
    expect(list.data).toEqual([]);
  });

  // ── 3. valid creation + product association ──

  it('03. creates rules bound to canonical products; rejects unknown products and bad shapes', async () => {
    const created = await service.createRule(baseRule(), 'workforce-operator-1');
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.productCode).toBe('WALLET_TRANSFER');
    expect(created.currency).toBe('NGN');
    expect(created.flatFeeMinor).toBe('0');
    expect(created.version).toBe(1);
    expect(created.isActive).toBe(true);
    expect(created.createdBy).toBe('workforce-operator-1');

    // association: FK targets products.code, and listing by product finds it
    const byProduct = await service.listRules({ productCode: 'WALLET_TRANSFER' });
    expect(byProduct.total).toBe(1);
    expect(byProduct.data[0]!.id).toBe(created.id);

    await expect(service.createRule(baseRule({ productCode: 'NOT_A_PRODUCT' }), 'test')).rejects.toMatchObject({ status: 404 });
    await expect(service.createRule(baseRule({ productCode: '' }), 'test')).rejects.toMatchObject({ status: 400 });
    await expect(service.createRule(baseRule({ currency: 'USDOLLAR' }), 'test')).rejects.toMatchObject({ status: 400 });
    await expect(service.createRule(baseRule({ flatFeeMinor: null, percentageBps: null }), 'test')).rejects.toMatchObject({ status: 400 });
    await expect(service.createRule(baseRule({ flatFeeMinor: '-5' }), 'test')).rejects.toMatchObject({ status: 400 });
    await expect(service.createRule(baseRule({ percentageBps: -1 }), 'test')).rejects.toMatchObject({ status: 400 });
    await expect(service.createRule(baseRule({ percentageBps: 10001 }), 'test')).rejects.toMatchObject({ status: 400 });
    await expect(service.createRule(baseRule({ minimumFeeMinor: '1000', maximumFeeMinor: '500', percentageBps: 10 }), 'test')).rejects.toMatchObject({ status: 400 });
    await expect(service.createRule(baseRule({ effectiveFrom: 'not-a-date' }), 'test')).rejects.toMatchObject({ status: 400 });
    const t0 = new Date('2030-01-02T00:00:00Z');
    await expect(service.createRule(baseRule({ effectiveFrom: t0, effectiveTo: '2030-01-01T00:00:00Z' }), 'test')).rejects.toMatchObject({ status: 400 });
    expect(await rowCount('fee_rules')).toBe(1); // only the valid rule persisted
  });

  // ── 4. pricing model expressiveness (schema accepts all non-tiered models) ──

  it('04. schema expresses ZERO/FREE, FLAT, PCT, PCT+MIN, PCT+MAX, PCT+MIN+MAX, FLAT+PCT', async () => {
    const models = [
      { productCode: 'WALLET_TRANSFER', flatFeeMinor: '0' }, // explicit ZERO/FREE
      { productCode: 'WALLET_TO_CASH', flatFeeMinor: '10000' }, // FLAT (synthetic test value)
      { productCode: 'CASH_TO_WALLET', flatFeeMinor: null, percentageBps: 25 }, // PERCENTAGE (synthetic)
      { productCode: 'CASH_TO_CASH', flatFeeMinor: null, percentageBps: 25, minimumFeeMinor: '5000' }, // PCT+MIN
      { productCode: 'CUSTOMER_FUNDING', flatFeeMinor: null, percentageBps: 25, maximumFeeMinor: '200000' }, // PCT+MAX
      { productCode: 'AGENT_FUNDING', flatFeeMinor: null, percentageBps: 25, minimumFeeMinor: '5000', maximumFeeMinor: '200000' }, // PCT+MIN+MAX
      { productCode: 'AGENT_DEFUNDING', flatFeeMinor: '1000', percentageBps: 25 }, // FLAT+PERCENTAGE (FeeEngine sums both)
    ];
    for (const m of models) {
      const created = await service.createRule(baseRule(m), 'test');
      expect(created.id).toBeTruthy();
    }
    expect(await rowCount('fee_rules')).toBe(7);
  });

  it('05. FeeEngine consumes stored rule parameters unchanged (calculation compatibility, no charging wired)', async () => {
    const created = await service.createRule(
      baseRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '1000', percentageBps: 25, minimumFeeMinor: '500', maximumFeeMinor: '50000', vatBps: 0 }),
      'test',
    );
    // synthetic math check only — the engine is invoked directly by the test; no flow calls it
    const calc = feeEngine.calculate('1000000', 'NGN', {
      paymentType: 'TRANSFER' as any,
      flatFeeMinor: created.flatFeeMinor!,
      percentageBps: created.percentageBps!,
      minimumFeeMinor: created.minimumFeeMinor!,
      maximumFeeMinor: created.maximumFeeMinor!,
      vatBps: created.vatBps ?? 0,
    });
    expect(calc.feeMinor).toBe('3500'); // 1000 + 1000000*25/10000 = 3500 (within min/max)
    expect(calc.totalMinor).toBe('1003500');
  });

  // ── 5. identity uniqueness & duplicate behavior ──

  it('06. identity (product_code, currency, effective_from) is unique; duplicates conflict deterministically', async () => {
    const effectiveFrom = '2031-05-01T00:00:00Z';
    await service.createRule(baseRule({ effectiveFrom }), 'test');
    await expect(service.createRule(baseRule({ effectiveFrom }), 'test')).rejects.toMatchObject({ status: 409 });
    // same identity over HTTP also conflicts
    await request(app.getHttpServer())
      .post('/api/v1/internal/fee-rules')
      .set('Authorization', auth('PRIVILEGED'))
      .send({ productCode: 'WALLET_TRANSFER', currency: 'NGN', flatFeeMinor: '0', effectiveFrom })
      .expect(409);

    // different effective_from → distinct rule (future policy window)
    await service.createRule(baseRule({ effectiveFrom: '2031-06-01T00:00:00Z' }), 'test');
    // same window, different currency → distinct rule
    await service.createRule(baseRule({ effectiveFrom, currency: 'USD' }), 'test');
    expect(await rowCount('fee_rules')).toBe(3);
  });

  // ── 6. versioning & concurrency ──

  it('07. updates are version-checked and audited; stale versions 409; identity immutable', async () => {
    const created = await service.createRule(baseRule(), 'test');
    expect(created.version).toBe(1);

    await expect(service.updateRule(created.id, { isActive: false, version: 99 }, 'test')).rejects.toMatchObject({ status: 409 });

    const updated = await service.updateRule(created.id, { flatFeeMinor: '250', priority: 5, version: 1 }, 'workforce-operator-1');
    expect(updated.version).toBe(2);
    expect(updated.flatFeeMinor).toBe('250');
    expect(updated.priority).toBe(5);
    expect(updated.updatedBy).toBe('workforce-operator-1');
    // identity fields unchanged
    expect(updated.productCode).toBe('WALLET_TRANSFER');
    expect(updated.currency).toBe('NGN');
    expect(new Date(updated.effectiveFrom).toISOString()).toBe(new Date(created.effectiveFrom).toISOString());

    // replaying the stale version conflicts
    await expect(service.updateRule(created.id, { isActive: false, version: 1 }, 'test')).rejects.toMatchObject({ status: 409 });

    // invariants still enforced on update
    await expect(service.updateRule(created.id, { percentageBps: 20000, version: 2 }, 'test')).rejects.toMatchObject({ status: 400 });
    await expect(service.updateRule(created.id, { flatFeeMinor: null, percentageBps: null, version: 2 }, 'test')).rejects.toMatchObject({ status: 400 });
    await expect(service.updateRule(created.id, { effectiveTo: '2020-01-01T00:00:00Z', version: 2 }, 'test')).rejects.toMatchObject({ status: 400 });
    await expect(service.updateRule(randomUUID(), { isActive: false, version: 1 }, 'test')).rejects.toMatchObject({ status: 404 });
    await expect(service.updateRule('not-a-uuid', { isActive: false, version: 1 }, 'test')).rejects.toMatchObject({ status: 400 });

    const audits: Array<{ entity_type: string; action: string }> = await dataSource.query(
      `SELECT entity_type, action FROM audit_events WHERE entity_type='FEE_RULE' ORDER BY occurred_at`,
    );
    expect(audits.some((a) => a.action === 'CREATED')).toBe(true);
    expect(audits.some((a) => a.action === 'UPDATED')).toBe(true);
  });

  it('08. concurrent updates: exactly one writer wins per version (optimistic locking)', async () => {
    const created = await service.createRule(baseRule(), 'test');
    const results = await Promise.allSettled([
      service.updateRule(created.id, { priority: 1, version: 1 }, 'writer-a'),
      service.updateRule(created.id, { priority: 2, version: 1 }, 'writer-b'),
    ]);
    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(String((losers[0] as any).reason.status)).toBe('409');
    const after = await service.getRule(created.id);
    expect(after.version).toBe(2);
    expect([1, 2]).toContain(after.priority);
  });

  // ── 7. API surface ──

  it('09. authorization: unauthenticated 401, non-workforce 403, workforce OPERATOR/SERVICE/PRIVILEGED allowed', async () => {
    await request(app.getHttpServer()).get('/api/v1/internal/fee-rules').expect(401);
    await request(app.getHttpServer()).post('/api/v1/internal/fee-rules').send({}).expect(401);

    for (const type of ['CUSTOMER', 'AGENT', 'AGGREGATOR', 'SUPPORT']) {
      await request(app.getHttpServer()).get('/api/v1/internal/fee-rules').set('Authorization', auth(type)).expect(403);
      await request(app.getHttpServer()).post('/api/v1/internal/fee-rules').set('Authorization', auth(type)).send({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '0' }).expect(403);
      await request(app.getHttpServer()).patch(`/api/v1/internal/fee-rules/${randomUUID()}`).set('Authorization', auth(type)).send({ version: 1 }).expect(403);
    }

    const created = await service.createRule(baseRule(), 'test');
    for (const type of ['OPERATOR', 'SERVICE', 'PRIVILEGED']) {
      await request(app.getHttpServer()).get('/api/v1/internal/fee-rules').set('Authorization', auth(type)).expect(200);
      await request(app.getHttpServer()).get(`/api/v1/internal/fee-rules/${created.id}`).set('Authorization', auth(type)).expect(200);
    }
  });

  it('10. safe projection and single-get behavior', async () => {
    const created = await service.createRule(baseRule({ percentageBps: 15, vatBps: 0 }), 'test');
    const one = await request(app.getHttpServer())
      .get(`/api/v1/internal/fee-rules/${created.id}`)
      .set('Authorization', auth('OPERATOR'))
      .expect(200);
    const body = JSON.stringify(one.body);
    for (const forbidden of ['password', 'pin', 'otp', 'secret', 'token', 'request_hash', 'requestHash']) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
    expect(one.body.productCode).toBe('WALLET_TRANSFER');
    expect(one.body.percentageBps).toBe(15);
    expect(one.body.version).toBe(1);

    await request(app.getHttpServer()).get(`/api/v1/internal/fee-rules/${randomUUID()}`).set('Authorization', auth('OPERATOR')).expect(404);
    await request(app.getHttpServer()).get('/api/v1/internal/fee-rules/not-a-uuid').set('Authorization', auth('OPERATOR')).expect(400);
    // no DELETE route — deactivation/ending is via PATCH
    await request(app.getHttpServer()).delete(`/api/v1/internal/fee-rules/${created.id}`).set('Authorization', auth('PRIVILEGED')).expect(404);
  });

  it('11. list filters, deterministic ordering and pagination validation', async () => {
    await service.createRule(baseRule({ productCode: 'WALLET_TRANSFER', effectiveFrom: '2031-01-01T00:00:00Z' }), 'test');
    await service.createRule(baseRule({ productCode: 'CASH_TO_CASH', effectiveFrom: '2031-01-01T00:00:00Z' }), 'test');
    const inactive = await service.createRule(baseRule({ productCode: 'CASH_TO_WALLET', effectiveFrom: '2031-01-01T00:00:00Z', isActive: false }), 'test');

    const all = await request(app.getHttpServer()).get('/api/v1/internal/fee-rules').set('Authorization', auth('OPERATOR')).expect(200);
    expect(all.body.total).toBe(3);

    const byProduct = await request(app.getHttpServer()).get('/api/v1/internal/fee-rules?productCode=CASH_TO_CASH').set('Authorization', auth('OPERATOR')).expect(200);
    expect(byProduct.body.total).toBe(1);

    const onlyActive = await request(app.getHttpServer()).get('/api/v1/internal/fee-rules?isActive=true').set('Authorization', auth('OPERATOR')).expect(200);
    expect(onlyActive.body.total).toBe(2);
    const onlyInactive = await request(app.getHttpServer()).get('/api/v1/internal/fee-rules?isActive=false').set('Authorization', auth('OPERATOR')).expect(200);
    expect(onlyInactive.body.total).toBe(1);
    expect(onlyInactive.body.data[0]!.id).toBe(inactive.id);

    const page = await request(app.getHttpServer()).get('/api/v1/internal/fee-rules?page=2&limit=2').set('Authorization', auth('OPERATOR')).expect(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.hasNextPage).toBe(false);
    await request(app.getHttpServer()).get('/api/v1/internal/fee-rules?page=0').set('Authorization', auth('OPERATOR')).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/fee-rules?limit=101').set('Authorization', auth('OPERATOR')).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/fee-rules?isActive=maybe').set('Authorization', auth('OPERATOR')).expect(400);
  });

  // ── 8. financial isolation & snapshot historical safety ──

  it('12. fee-rule administration never mutates wallets, ledger, limit usage/reservations or snapshots', async () => {
    const before = await financialTables();
    const created = await service.createRule(baseRule(), 'test');
    await service.updateRule(created.id, { priority: 3, version: 1 }, 'test');
    await service.listRules({});
    const after = await financialTables();
    expect(after).toEqual(before);
  });

  it('13. snapshot historical safety: snapshots capture fee ruleId+version and stay immutable after rule changes', async () => {
    const rule = await service.createRule(baseRule({ productCode: 'WALLET_TRANSFER' }), 'test');
    const snapshot = await snapshotService.recordDecision({
      idempotencyKey: `comm-03:${randomUUID()}`,
      product: 'WALLET_TRANSFER',
      direction: 'OUTGOING',
      channel: null,
      principalType: 'CUSTOMER',
      principalId: randomUUID(),
      currency: 'NGN',
      principalAmountMinor: '50000',
      transactionReference: `TXN-${randomUUID().slice(0, 12)}`,
      correlationId: null,
      journalId: null,
      decisionStatus: 'FINAL',
      // NOT_CONFIGURED decision — but ruleRefs can already reference the registry row for future APPLIED decisions
      feeDecision: { ...feeNotConfigured('NGN', '50000'), ruleRefs: [{ ruleId: rule.id, ruleVersion: rule.version }] },
      commissionDecision: commissionNone(),
      rewardDecision: rewardNone(),
      limitDecision: limitNotEvaluated(),
      revenueDecision: null,
      configurationVersion: 'CFG-COMM03-1',
      createdBy: 'test-suite',
    } as any);
    const snapshotId = snapshot.snapshot.id as string;

    // change the rule afterwards (new version)
    await service.updateRule(rule.id, { flatFeeMinor: '777', version: 1 }, 'test');
    const currentRule = await service.getRule(rule.id);
    expect(currentRule.version).toBe(2);

    // snapshot untouched: historical decision remains explainable
    const rows: Array<Record<string, unknown>> = await dataSource.query(`SELECT * FROM commercial_decision_snapshots WHERE id=$1`, [snapshotId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.product).toBe('WALLET_TRANSFER');
    expect((rows[0]!.fee_decision as any).ruleRefs).toEqual([{ ruleId: rule.id, ruleVersion: 1 }]);
    expect((rows[0]!.fee_decision as any).status).toBe('NOT_CONFIGURED');

    // snapshots still immutable — no UPDATE/DELETE behavior was added by this task
    await expect(dataSource.query(`UPDATE commercial_decision_snapshots SET product='X' WHERE id=$1`, [snapshotId])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );
    await expect(dataSource.query(`DELETE FROM commercial_decision_snapshots WHERE id=$1`, [snapshotId])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );
  });

  it('14. no runtime wiring: no flow service references the fee-rule registry (schema foundation only)', async () => {
    for (const flow of [
      '../src/transfer/transfer.service.ts',
      '../src/agent/agent-cash-in.service.ts',
      '../src/agent/agent-cash-out.service.ts',
      '../src/agent/agent-cash-to-cash.service.ts',
      '../src/agent/agent-cash-to-cash-claim.service.ts',
      '../src/customer-funding/customer-funding.service.ts',
      '../src/agent/agent-funding.service.ts',
    ]) {
      const source = readFileSync(join(__dirname, flow), 'utf8');
      expect(source).not.toContain('FeeRuleRegistryService');
      expect(source).not.toContain('fee_rules');
    }
    const registrySource = readFileSync(join(__dirname, '../src/fee-rules/fee-rule-registry.service.ts'), 'utf8');
    expect(registrySource).not.toContain('DELETE FROM');
    expect(registrySource).not.toContain('UPDATE fee_rules');
  });
});
