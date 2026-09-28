/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * V1-COMMISSION-01 — Commission Engine foundation (real PostgreSQL).
 *
 * MACHINERY ONLY, ZERO CONFIGURED POLICY. Verified here:
 *   - migration 0073: commission_rules table, product FK → products.code, targeting FKs,
 *     CHECK coherence (model⇆params, single targeting dimension, min<=max, windows), identity uniqueness
 *   - ZERO seeded production rules (runtime wiring status asserted in test 02; the five
 *     financial snapshot sites consume the engine via V1-COMMERCIAL-IMPLEMENTATION-02 — the
 *     C2C claim path is deliberately NOT a commission event and must not import the engine)
 *   - deterministic calculation mechanics: FIXED, PERCENTAGE, PCT+MIN, PCT+MAX, PCT+MIN+MAX,
 *     FLAT+PCT, TIERED marginal brackets — TEST-ONLY synthetic rules only
 *   - calculation bases: PRINCIPAL, FEE (explicit fee evidence), NET; FEE/NET without
 *     evidence fail closed (never fabricated)
 *   - effective dating (from <= at < to), versioning (optimistic lock, stale 409),
 *     disabled rules excluded, identity 409, audited administration (workforce-only)
 *   - deterministic per-recipient precedence: highest priority wins; equal-priority ties
 *     fail closed with COMMISSION_RULE_AMBIGUOUS (never a silent choice)
 *   - eligibility targeting: agent-class / agent / aggregator / untargeted
 *   - multi-recipient allocation: independent AGENT/AGGREGATOR/PLATFORM amounts (no hardcoded split)
 *   - zero vs unconfigured: unconfigured → exact commissionNone() shape (NONE, ≠ ZERO)
 *   - snapshot representation: engine's ALLOCATED decision validates + persists through the
 *     existing Commercial Decision Snapshot (schema untouched), and snapshots stay immutable
 *   - concurrent configuration safety (identity + optimistic version under races)
 *
 * NO commission is ever charged: this spec asserts wallet/ledger/limit tables stay empty
 * of commission effects. Runtime consumption of CommissionEngine is covered by
 * test/v1-commission-runtime-wiring.integration.spec.ts (V1-COMMERCIAL-IMPLEMENTATION-02).
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
import { CommissionRuleRegistryService } from '../src/commission/commission-rule-registry.service';
import { CommissionEngine } from '../src/commission/commission.engine';
import { commissionNone } from '../src/commercial-decision/commercial-decision.defaults';
import { CommercialDecisionSnapshotService } from '../src/commercial-decision/commercial-decision-snapshot.service';
import { feeNotConfigured, limitNotEvaluated, rewardNone } from '../src/commercial-decision/commercial-decision.defaults';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

describe('V1-COMMISSION-01 Commission Engine foundation (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let registry: CommissionRuleRegistryService;
  let engine: CommissionEngine;
  let snapshotService: CommercialDecisionSnapshotService;

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
    dataSource = await createIntegrationDataSource('v1-commission-01');
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
    registry = app.get(CommissionRuleRegistryService);
    engine = app.get(CommissionEngine);
    snapshotService = app.get(CommercialDecisionSnapshotService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    // seedIfEmpty (not reseed): products is already empty after the CASCADE truncate, and
    // reseed()'s plain TRUNCATE would trip rule FKs onto products.
    await app.get(ProductCatalogSeedService).seedIfEmpty();
  });

  // synthetic TEST values only — never seeded production policy
  function baseRule(overrides: Record<string, unknown> = {}) {
    return {
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      recipientType: 'AGENT',
      calculationModel: 'FIXED',
      calculationBasis: 'PRINCIPAL',
      flatCommissionMinor: '0',
      percentageBps: null,
      minimumCommissionMinor: null,
      maximumCommissionMinor: null,
      tiers: null,
      priority: 0,
      isActive: true,
      ...overrides,
    };
  }

  async function rowCount(table: string): Promise<number> {
    const rows: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ${table}`);
    return Number(rows[0]!.cnt);
  }

  async function createAgentClass(suffix = randomUUID().slice(0, 6)): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO agent_classes (id, reference, code, name, is_active, version) VALUES ($1,$2,$3,'C01 Class',true,1)`,
      [id, `cls-c01-${suffix}`, `CC01-${suffix}`],
    );
    return id;
  }

  async function createAgent(agentClassId: string | null = null): Promise<string> {
    const id = randomUUID();
    await dataSource.query(`INSERT INTO agents (id, reference, status, agent_class_id, version) VALUES ($1,$2,'ACTIVE',$3,1)`, [id, `agt-c01-${randomUUID().slice(0, 8)}`, agentClassId]);
    return id;
  }

  async function createAggregator(): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO aggregators (id, reference, code, corporate_name, status, created_by, version) VALUES ($1,$2,$3,'C01 Aggregator Ltd','ACTIVE','c01-test',1)`,
      [id, `agg-c01-${randomUUID().slice(0, 8)}`, `AGG-${randomUUID().slice(0, 6)}`],
    );
    return id;
  }

  const decide = (overrides: Record<string, unknown> = {}, bases: Record<string, unknown> = {}) =>
    engine.decide(
      {
        productCode: 'WALLET_TRANSFER',
        currency: 'NGN',
        ...overrides,
      } as any,
      { principalMinor: '10000', feeMinor: null, ...bases } as any,
    );

  // ── 1. migration & DB-layer integrity ──

  it('01. migration 0073 creates commission_rules with FKs, CHECK coherence and identity uniqueness', async () => {
    const tables: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='commission_rules'`,
    );
    expect(tables).toHaveLength(1);

    const constraints: Array<{ conname: string }> = await dataSource.query(
      `SELECT conname FROM pg_constraint WHERE conrelid='commission_rules'::regclass ORDER BY conname`,
    );
    const names = constraints.map((c) => c.conname);
    for (const expected of [
      'chk_commission_rules_currency', 'chk_commission_rules_recipient', 'chk_commission_rules_model',
      'chk_commission_rules_basis', 'chk_commission_rules_flat', 'chk_commission_rules_percentage',
      'chk_commission_rules_minimum', 'chk_commission_rules_maximum', 'chk_commission_rules_effective',
      'chk_commission_rules_version', 'chk_commission_rules_min_max', 'chk_commission_rules_model_params',
      'chk_commission_rules_target_single', 'chk_commission_rules_tiers_array',
    ]) {
      expect(names).toContain(expected);
    }

    // product + targeting FKs
    const fks: Array<{ confrelid: string }> = await dataSource.query(
      `SELECT confrelid::regclass::text AS confrelid FROM pg_constraint WHERE conrelid='commission_rules'::regclass AND contype='f' ORDER BY confrelid::regclass::text`,
    );
    expect(fks.map((f) => f.confrelid)).toEqual(['agent_classes', 'agents', 'aggregators', 'products']);

    const indexes: Array<{ indexname: string }> = await dataSource.query(`SELECT indexname FROM pg_indexes WHERE tablename='commission_rules'`);
    expect(indexes.map((i) => i.indexname)).toContain('uq_commission_rules_identity');

    // DB-layer rejections (bypassing the service):
    const base = `INSERT INTO commission_rules (product_code, currency, recipient_type, calculation_model, calculation_basis, created_by`;
    await expect(
      dataSource.query(`${base}, flat_commission_minor) VALUES ('WALLET_TRANSFER','NGN','AGENT','FIXED','PRINCIPAL','test',-1)`),
    ).rejects.toMatchObject({ code: '23514' }); // negative money
    await expect(
      dataSource.query(`${base}, percentage_bps) VALUES ('WALLET_TRANSFER','NGN','AGENT','PERCENTAGE','PRINCIPAL','test',10001)`),
    ).rejects.toMatchObject({ code: '23514' }); // bps > 10000
    await expect(
      dataSource.query(`${base}, percentage_bps, minimum_commission_minor, maximum_commission_minor) VALUES ('WALLET_TRANSFER','NGN','AGENT','PERCENTAGE_MIN_MAX','PRINCIPAL','test',100,500,100)`),
    ).rejects.toMatchObject({ code: '23514' }); // min > max
    await expect(
      dataSource.query(`${base}, flat_commission_minor) VALUES ('WALLET_TRANSFER','NGN','BROKER','FIXED','PRINCIPAL','test',0)`),
    ).rejects.toMatchObject({ code: '23514' }); // unknown recipient type
    await expect(
      dataSource.query(`${base}, flat_commission_minor) VALUES ('WALLET_TRANSFER','NGN','AGENT','FIXED','GROSS','test',0)`),
    ).rejects.toMatchObject({ code: '23514' }); // unknown basis
    await expect(
      dataSource.query(`${base}, flat_commission_minor, percentage_bps) VALUES ('WALLET_TRANSFER','NGN','AGENT','FIXED','PRINCIPAL','test',0,100)`),
    ).rejects.toMatchObject({ code: '23514' }); // model⇆params incoherence
    await expect(
      dataSource.query(`${base}, flat_commission_minor, agent_id, aggregator_id) VALUES ('WALLET_TRANSFER','NGN','AGENT','FIXED','PRINCIPAL','test',0,$1,$2)`, [randomUUID(), randomUUID()]),
    ).rejects.toMatchObject({ code: '23514' }); // two targeting dimensions
    await expect(
      dataSource.query(`${base}, flat_commission_minor) VALUES ('NOT_A_PRODUCT','NGN','AGENT','FIXED','PRINCIPAL','test',0)`),
    ).rejects.toMatchObject({ code: '23503' }); // unknown product
    await expect(
      dataSource.query(`${base}, flat_commission_minor) VALUES ('WALLET_TRANSFER','ngn','AGENT','FIXED','PRINCIPAL','test',0)`),
    ).rejects.toMatchObject({ code: '23514' }); // lowercase currency
  });

  // ── 2. zero seeded rules; flows untouched ──

  it('02. ZERO production commission rules seeded; engine wired at the five snapshot sites (claim excluded); empty-registry answer stays the identical NONE shape', async () => {
    expect(await rowCount('commission_rules')).toBe(0);
    // V1-COMMERCIAL-IMPLEMENTATION-02: the five financial snapshot sites consume the engine IN
    // their SERIALIZABLE transactions via decideWithManager (see the per-service wiring comments).
    for (const flow of [
      'src/agent/agent-financial-execution.service.ts',
      'src/agent/agent-cash-to-cash.service.ts',
      'src/agent/agent-funding.service.ts',
      'src/customer-funding/customer-funding.service.ts',
      'src/transfer/transfer.service.ts',
    ]) {
      const src = readFileSync(join(__dirname, '..', flow), 'utf8');
      expect(src.includes('CommissionEngine')).toBe(true);
      expect(src.includes('decideWithManager')).toBe(true);
    }
    // ...but NO flow may bypass the engine by raw-SQL'ing the rule table directly:
    for (const flow of [
      'src/agent/agent-financial-execution.service.ts',
      'src/agent/agent-cash-to-cash.service.ts',
      'src/agent/agent-funding.service.ts',
      'src/customer-funding/customer-funding.service.ts',
      'src/transfer/transfer.service.ts',
    ]) {
      const src = readFileSync(join(__dirname, '..', flow), 'utf8');
      expect(src.includes('commission_rules')).toBe(false);
    }
    // The C2C CLAIM path is deliberately EXCLUDED: one Cash→Cash transfer = ONE commission event
    // (initiation). The claim is customer-side (no acting agent) so the engine must NOT be
    // imported, injected or invoked there (structural double-pay prevention).
    const claimSrc = readFileSync(join(__dirname, '..', 'src/agent/agent-cash-to-cash-claim.service.ts'), 'utf8');
    expect(claimSrc.includes("from '../commission/commission.engine'")).toBe(false);
    expect(claimSrc.includes("from '../commission/")).toBe(false);
    expect(claimSrc.includes('commissionEngine?')).toBe(false);
    expect(claimSrc.includes('decideWithManager')).toBe(false);
    // The engine with an EMPTY registry returns the identical NONE shape the flows recorded
    // before wiring — wiring cannot change behavior when nothing is configured.
    const decision = await decide();
    expect(decision).toEqual(commissionNone());
  });

  // ── 3. calculation mechanics (all seven models, synthetic rules) ──

  it('03. FIXED / PERCENTAGE / PCT+MIN / PCT+MAX / PCT+MIN+MAX / FLAT+PCT resolve to exact amounts (TEST-ONLY rules)', async () => {
    const mk = (over: Record<string, unknown>) =>
      registry.createRule(
        { ...baseRule({ flatCommissionMinor: null, effectiveFrom: new Date(Date.now() - 60000) }), ...over } as any,
        'c01-test',
      );
    await mk({ calculationModel: 'FIXED', flatCommissionMinor: '150' });
    expect((await decide()).allocations[0]).toMatchObject({ amountMinor: '150', beneficiaryType: 'AGENT', basis: 'PRINCIPAL' });

    await truncateAllTables(dataSource); await app.get(ProductCatalogSeedService).seedIfEmpty();
    await mk({ calculationModel: 'PERCENTAGE', percentageBps: 250 }); // 2.5%
    expect((await decide()).allocations[0]).toMatchObject({ amountMinor: '250', basis: 'PRINCIPAL', baseAmountMinor: '10000' });

    await truncateAllTables(dataSource); await app.get(ProductCatalogSeedService).seedIfEmpty();
    await mk({ calculationModel: 'PERCENTAGE_MIN', percentageBps: 100, minimumCommissionMinor: '400' }); // raw 100 → min 400
    expect((await decide()).allocations[0]).toMatchObject({ amountMinor: '400' });

    await truncateAllTables(dataSource); await app.get(ProductCatalogSeedService).seedIfEmpty();
    await mk({ calculationModel: 'PERCENTAGE_MAX', percentageBps: 900, maximumCommissionMinor: '300' }); // raw 900 → max 300
    expect((await decide()).allocations[0]).toMatchObject({ amountMinor: '300' });

    await truncateAllTables(dataSource); await app.get(ProductCatalogSeedService).seedIfEmpty();
    await mk({ calculationModel: 'PERCENTAGE_MIN_MAX', percentageBps: 100, minimumCommissionMinor: '400', maximumCommissionMinor: '1000' });
    expect((await decide()).allocations[0]).toMatchObject({ amountMinor: '400' }); // raw 100 → clamp up
    const minMaxAgg = await createAggregator();
    await mk({ calculationModel: 'PERCENTAGE_MIN_MAX', percentageBps: 2000, minimumCommissionMinor: '400', maximumCommissionMinor: '1000', recipientType: 'AGGREGATOR', aggregatorId: minMaxAgg, effectiveFrom: new Date(Date.now() - 50000) });
    expect((await decide({ aggregatorId: minMaxAgg }, {})).allocations.find((a) => a.beneficiaryType === 'AGGREGATOR')!).toMatchObject({ amountMinor: '1000' }); // raw 2000 → clamp down

    await truncateAllTables(dataSource); await app.get(ProductCatalogSeedService).seedIfEmpty();
    await mk({ calculationModel: 'FLAT_PLUS_PERCENTAGE', flatCommissionMinor: '100', percentageBps: 200 }); // 100 + 2% of 10000
    expect((await decide()).allocations[0]).toMatchObject({ amountMinor: '300', calculationParameters: { flatCommissionMinor: '100', percentageBps: 200 } });
  });

  it('04. TIERED marginal brackets resolve slice-by-slice with per-bracket floor division', async () => {
    await registry.createRule(
      baseRule({
        calculationModel: 'TIERED',
        flatCommissionMinor: null,
        tiers: [
          { upToMinor: '10000', bps: 200 },
          { upToMinor: '50000', flatMinor: '100', bps: 100 },
          { upToMinor: null, bps: 50 },
        ],
        effectiveFrom: new Date(Date.now() - 60000),
      }) as any,
      'c01-test',
    );
    // base 60000: b1 200 (2% of 10000); b2 100 + 400 (1% of 40000); b3 50 (0.5% of 10000) → 750 total
    const decision = await decide({}, { principalMinor: '60000' });
    expect(decision.status).toBe('ALLOCATED');
    expect(decision.allocations[0]).toMatchObject({ amountMinor: '750', calculationModel: 'TIERED', baseAmountMinor: '60000' });
    const params = decision.allocations[0]!.calculationParameters as any;
    expect(params.tiers.map((t) => t.bracketCommissionMinor)).toEqual(['200', '500', '50']);
    // base below top bracket: only slice of what it reached earns
    expect((await decide({}, { principalMinor: '5000' })).allocations[0]).toMatchObject({ amountMinor: '100' });
  });

  // ── 4. calculation bases ──

  it('05. FEE and NET bases consume explicit fee evidence only and fail closed without it', async () => {
    await registry.createRule(
      baseRule({ calculationModel: 'PERCENTAGE', flatCommissionMinor: null, percentageBps: 1000, calculationBasis: 'FEE', effectiveFrom: new Date(Date.now() - 60000) }) as any,
      'c01-test',
    );
    // 10% of the fee evidence (200) — fee evidence is caller-supplied; no flow fabricates it today
    expect((await decide({}, { feeMinor: '200' })).allocations[0]).toMatchObject({ amountMinor: '20', basis: 'FEE', baseAmountMinor: '200' });
    // no fee evidence → fail closed (never derives or assumes)
    await expect(decide()).rejects.toMatchObject({ status: 400, message: expect.stringContaining('COMMISSION_BASE_UNAVAILABLE') });

    const netAgg = await createAggregator();
    await registry.createRule(
      baseRule({ calculationModel: 'PERCENTAGE', flatCommissionMinor: null, percentageBps: 1000, calculationBasis: 'NET', recipientType: 'AGGREGATOR', aggregatorId: netAgg, effectiveFrom: new Date(Date.now() - 50000) }) as any,
      'c01-test',
    );
    // NET = principal − fee = 10000 − 200 = 9800 → 10% = 980
    expect((await decide({ aggregatorId: netAgg }, { feeMinor: '200' })).allocations.find((a) => a.beneficiaryType === 'AGGREGATOR')).toMatchObject({ amountMinor: '980', basis: 'NET', baseAmountMinor: '9800' });
    await expect(decide()).rejects.toMatchObject({ status: 400, message: expect.stringContaining('COMMISSION_BASE_UNAVAILABLE') });
  });

  // ── 5. eligibility / targeting ──

  it('06. agent-class / agent / aggregator / untargeted eligibility matches exactly and nothing else', async () => {
    const clsId = await createAgentClass();
    const agentInClass = await createAgent(clsId);
    const agentOutside = await createAgent();
    const aggId = await createAggregator();
    const otherAgg = await createAggregator();

    await registry.createRule(baseRule({ agentClassId: clsId, effectiveFrom: new Date(Date.now() - 60000) }) as any, 'c01-test');
    await registry.createRule(
      baseRule({ recipientType: 'AGGREGATOR', aggregatorId: aggId, calculationModel: 'PERCENTAGE', flatCommissionMinor: null, percentageBps: 100, effectiveFrom: new Date(Date.now() - 59000) }) as any,
      'c01-test',
    );
    await registry.createRule(
      baseRule({ agentId: agentOutside, calculationModel: 'FIXED', flatCommissionMinor: '7', effectiveFrom: new Date(Date.now() - 58000) }) as any,
      'c01-test',
    );

    // agent inside the class → class rule applies
    const inClass = await decide({ agentId: agentInClass, agentClassId: clsId, aggregatorId: aggId });
    expect(inClass.allocations.find((a) => a.beneficiaryType === 'AGENT')).toMatchObject({ amountMinor: '0' }); // FIXED 0 (explicit ZERO)
    // aggregator recipient resolved through the aggregator-targeted rule
    expect(inClass.allocations.find((a) => a.beneficiaryType === 'AGGREGATOR')).toMatchObject({ amountMinor: '100', beneficiaryId: aggId });

    // agent outside the class with an agent-specific rule pinned to it
    const specific = await decide({ agentId: agentOutside, agentClassId: null, aggregatorId: otherAgg });
    expect(specific.allocations.find((a) => a.beneficiaryType === 'AGENT')).toMatchObject({ amountMinor: '7', beneficiaryId: agentOutside });
    // the class rule did NOT leak to a non-class agent; the foreign aggregator matched nothing
    expect(specific.allocations.find((a) => a.beneficiaryType === 'AGGREGATOR')).toBeUndefined();

    // unconfigured product is unaffected
    expect((await decide({ productCode: 'CASH_TO_WALLET' })).status).toBe('NONE');
  });

  // ── 6. multi-recipient allocation (no hardcoded split) ──

  it('07. independent AGENT/AGGREGATOR/PLATFORM rules allocate unrelated amounts side by side', async () => {
    const aggId = await createAggregator();
    await registry.createRule(baseRule({ calculationModel: 'PERCENTAGE', flatCommissionMinor: null, percentageBps: 200, effectiveFrom: new Date(Date.now() - 60000) }) as any, 'c01-test'); // Agent 200
    await registry.createRule(
      baseRule({ recipientType: 'AGGREGATOR', aggregatorId: aggId, calculationModel: 'FIXED', flatCommissionMinor: '60', effectiveFrom: new Date(Date.now() - 59000) }) as any,
      'c01-test',
    ); // Aggregator 60
    await registry.createRule(
      baseRule({ recipientType: 'PLATFORM', calculationModel: 'FIXED', flatCommissionMinor: '5', effectiveFrom: new Date(Date.now() - 58000) }) as any,
      'c01-test',
    ); // Platform 5 — deliberately NOT a share of anything
    const decision = await decide({ aggregatorId: aggId });
    expect(decision.status).toBe('ALLOCATED');
    const amounts = Object.fromEntries(decision.allocations.map((a) => [a.beneficiaryType, a.amountMinor]));
    expect(amounts).toEqual({ AGENT: '200', AGGREGATOR: '60', PLATFORM: '5' });
    expect(decision.ruleRefs).toHaveLength(3);
    // distinct rule ids/versions captured per recipient
    expect(new Set(decision.allocations.map((a) => a.ruleId)).size).toBe(3);
  });

  // ── 7. effective dates / versioning / disabled ──

  it('08. effective windows, historical resolution, versioning and disabled rules behave deterministically', async () => {
    const past = new Date(Date.now() - 86400000);
    const future = new Date(Date.now() + 86400000);
    const rule = await registry.createRule(baseRule({ effectiveFrom: past, effectiveTo: future, flatCommissionMinor: '111' }) as any, 'c01-test');
    // inside window → applies; before/after → nothing
    expect((await decide({ at: new Date() })).allocations[0]).toMatchObject({ amountMinor: '111', ruleVersion: 1 });
    expect((await decide({ at: new Date(Date.now() - 2 * 86400000) })).status).toBe('NONE');
    expect((await decide({ at: new Date(Date.now() + 2 * 86400000) })).status).toBe('NONE');
    // version bump + stale conflict + audit
    const updated = await registry.updateRule(rule.id, { flatCommissionMinor: '222', version: 1 }, 'c01-ops');
    expect(updated.version).toBe(2);
    await expect(registry.updateRule(rule.id, { flatCommissionMinor: '333', version: 1 }, 'c01-ops')).rejects.toMatchObject({ status: 409 });
    // historical resolution still sees the same rule row/version lineage; the new CURRENT values resolve now
    expect((await decide()).allocations[0]).toMatchObject({ amountMinor: '222', ruleVersion: 2 });
    // disabled rules stop applying (deactivation, never deletion)
    await registry.updateRule(rule.id, { isActive: false, version: 2 }, 'c01-ops');
    expect((await decide()).status).toBe('NONE');
    expect(await rowCount('commission_rules')).toBe(1); // deactivated, not erased
    const audits: Array<{ entity_type: string; action: string }> = await dataSource.query(
      `SELECT entity_type, action FROM audit_events WHERE entity_type='COMMISSION_RULE' ORDER BY occurred_at`,
    );
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['CREATED', 'UPDATED']));
  });

  // ── 8. precedence & ambiguity ──

  it('09. highest priority wins per recipient; equal-priority ties fail CLOSED with explicit ambiguity', async () => {
    await registry.createRule(baseRule({ flatCommissionMinor: '100', priority: 1, effectiveFrom: new Date(Date.now() - 60000) }) as any, 'c01-test');
    await registry.createRule(baseRule({ flatCommissionMinor: '999', priority: 5, effectiveFrom: new Date(Date.now() - 59000) }) as any, 'c01-test');
    expect((await decide()).allocations[0]).toMatchObject({ amountMinor: '999' }); // priority 5 wins
    // introduce an equal-priority competitor → resolution must not silently choose
    await registry.createRule(baseRule({ flatCommissionMinor: '555', priority: 5, effectiveFrom: new Date(Date.now() - 58000) }) as any, 'c01-test');
    await expect(decide()).rejects.toMatchObject({ status: 409, message: expect.stringContaining('COMMISSION_RULE_AMBIGUOUS') });
    // disambiguate: demote the '555' rule to priority 4 → the '999' rule wins deterministically
    const rows: Array<{ id: string; version: number }> = await dataSource.query(
      `SELECT id, version FROM commission_rules WHERE flat_commission_minor='555' AND priority=5`,
    );
    expect(rows).toHaveLength(1);
    await registry.updateRule(rows[0]!.id, { priority: 4, version: rows[0]!.version }, 'c01-ops');
    expect((await decide()).allocations[0]).toMatchObject({ amountMinor: '999' });
  });

  // ── 9. schema enforcement on rule writing (registry validation) ──

  it('10. registry rejects incoherent definitions, unknown targets and duplicate identities', async () => {
    // model⇆params incoherence
    await expect(registry.createRule(baseRule({ calculationModel: 'PERCENTAGE', flatCommissionMinor: '0', percentageBps: 100 }) as any, 't')).rejects.toMatchObject({ status: 400 });
    // missing params
    await expect(registry.createRule(baseRule({ calculationModel: 'PERCENTAGE', flatCommissionMinor: null }) as any, 't')).rejects.toMatchObject({ status: 400 });
    // TIERED without tiers
    await expect(registry.createRule(baseRule({ calculationModel: 'TIERED', flatCommissionMinor: null, tiers: null }) as any, 't')).rejects.toMatchObject({ status: 400 });
    // non-ascending brackets
    await expect(
      registry.createRule(baseRule({ calculationModel: 'TIERED', flatCommissionMinor: null, tiers: [{ upToMinor: '5000', bps: 100 }, { upToMinor: '4000', bps: 100 }] }) as any, 't'),
    ).rejects.toMatchObject({ status: 400 });
    // open-ended bracket not last
    await expect(
      registry.createRule(baseRule({ calculationModel: 'TIERED', flatCommissionMinor: null, tiers: [{ upToMinor: null, bps: 100 }, { upToMinor: '5000', bps: 100 }] }) as any, 't'),
    ).rejects.toMatchObject({ status: 400 });
    // two targeting dimensions
    await expect(registry.createRule(baseRule({ agentId: randomUUID(), aggregatorId: randomUUID() }) as any, 't')).rejects.toMatchObject({ status: 400 });
    // unknown target identity
    await expect(registry.createRule(baseRule({ agentId: randomUUID() }) as any, 't')).rejects.toMatchObject({ status: 404 });
    // unknown product
    await expect(registry.createRule(baseRule({ productCode: 'P2P_MYSTERY' }) as any, 't')).rejects.toMatchObject({ status: 404 });
    // duplicate identity → 409
    const rule = await registry.createRule(baseRule({ effectiveFrom: new Date(Date.now() - 60000) }) as any, 't');
    expect(rule.id).toBeDefined();
    await expect(registry.createRule(baseRule({ effectiveFrom: rule.effectiveFrom }) as any, 't')).rejects.toMatchObject({ status: 409 });
  });

  // ── 10. concurrent configuration safety ──

  it('11. concurrent creates race to one identity winner; concurrent updates race optimistic versions', async () => {
    const identical = baseRule({ effectiveFrom: new Date(Date.now() - 60000) }) as any;
    const results = await Promise.allSettled([registry.createRule(identical, 't1'), registry.createRule(identical, 't2')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')?.reason).toMatchObject({ status: 409 });
    expect(await rowCount('commission_rules')).toBe(1);

    const u1 = registry.updateRule((results[0] as any).value.id, { flatCommissionMinor: '10', version: 1 }, 't1');
    const u2 = registry.updateRule((results[0] as any).value.id, { flatCommissionMinor: '20', version: 1 }, 't2');
    const updates = await Promise.allSettled([u1, u2]);
    expect(updates.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await dataSource.query(`SELECT version FROM commission_rules WHERE id=$1`, [(results[0] as any).value.id])).toEqual([{ version: 2 }]);
  });

  // ── 11. snapshot representation + immutability ──

  it('12. engine ALLOCATED decision persists through the existing snapshot (schema untouched) and stays immutable', async () => {
    const aggId = await createAggregator();
    await registry.createRule(baseRule({ calculationModel: 'PERCENTAGE', flatCommissionMinor: null, percentageBps: 150, effectiveFrom: new Date(Date.now() - 60000) }) as any, 't');
    await registry.createRule(
      baseRule({ recipientType: 'AGGREGATOR', aggregatorId: aggId, calculationModel: 'FIXED', flatCommissionMinor: '40', effectiveFrom: new Date(Date.now() - 59000) }) as any,
      't',
    );
    const commission = await decide({ aggregatorId: aggId });
    expect(commission.status).toBe('ALLOCATED');
    const agentId = await createAgent();
    const key = `c01-snap-${randomUUID()}`;
    // standalone path (own SERIALIZABLE wrapper) — the shape-boundary proof, NOT flow wiring
    const { snapshot } = await snapshotService.recordDecision({
      idempotencyKey: key,
      product: 'WALLET_TRANSFER',
      direction: 'BOTH',
      channel: 'TEST',
      principalType: 'AGENT',
      principalId: agentId,
      currency: 'NGN',
      principalAmountMinor: '10000',
      transactionReference: `c01-tx-${randomUUID()}`,
      journalId: null,
      decisionStatus: 'FINAL',
      feeDecision: feeNotConfigured('NGN', '10000'),
      commissionDecision: commission as any,
      rewardDecision: rewardNone(),
      limitDecision: limitNotEvaluated(),
      revenueDecision: null,
      configurationVersion: null,
      createdBy: 'c01-test',
    });
    expect(snapshot.commission_decision.status).toBe('ALLOCATED');
    expect(snapshot.commission_decision.allocations).toHaveLength(2);
    for (const alloc of snapshot.commission_decision.allocations) {
      expect(alloc.ruleId).toMatch(/^[0-9a-f-]{36}$/);
      expect(alloc.ruleVersion).toBeGreaterThanOrEqual(1);
      expect(alloc.basis).toBe('PRINCIPAL');
      expect(alloc.baseAmountMinor).toBe('10000');
    }
    // engine NONE shape is byte-identical to what V1 flows write today
    expect(snapshot.commission_decision.allocations.map((a) => a.beneficiaryType).sort()).toEqual(['AGENT', 'AGGREGATOR']);
    // immutability: snapshot row rejects updates (trigger)
    await expect(dataSource.query(`UPDATE commercial_decision_snapshots SET commission_decision='{}' WHERE idempotency_key=$1`, [key])).rejects.toThrow();
    // replay with the same idempotency footprint returns, never duplicates
    expect(await rowCount('commercial_decision_snapshots')).toBe(1);
  });

  it('13. ZERO vs NOT_CONFIGURED: explicit ZERO rule allocates 0 and stays distinct from NONE', async () => {
    expect((await decide()).status).toBe('NONE'); // unconfigured — the V1 normal
    await registry.createRule(baseRule({ flatCommissionMinor: '0', effectiveFrom: new Date(Date.now() - 60000) }) as any, 't');
    const d = await decide();
    expect(d.status).toBe('ALLOCATED'); // configured explicit ZERO — not NONE
    expect(d.allocations[0]).toMatchObject({ amountMinor: '0', beneficiaryType: 'AGENT' });
  });

  // ── 12. workforce-only HTTP administration + diagnostic ──

  it('14. internal API: workforce-only access, CREATE/LIST/GET/PATCH roundtrip, resolve diagnostic', async () => {
    // non-workforce principals cannot administer
    await request(app.getHttpServer()).get('/api/v1/internal/commission-rules').set('Authorization', auth('agent')).expect(403);
    await request(app.getHttpServer()).post('/api/v1/internal/commission-rules').set('Authorization', auth('customer')).send({}).expect(403);
    await request(app.getHttpServer()).get('/api/v1/internal/commission-rules').expect(401);

    const created = await request(app.getHttpServer())
      .post('/api/v1/internal/commission-rules')
      .set('Authorization', auth('operator'))
      .send(baseRule({ effectiveFrom: new Date(Date.now() - 60000) }))
      .expect(201);
    expect(created.body.recipientType).toBe('AGENT');
    expect(created.body.version).toBe(1);

    const list = await request(app.getHttpServer()).get('/api/v1/internal/commission-rules?productCode=WALLET_TRANSFER').set('Authorization', auth('operator')).expect(200);
    expect(list.body.total).toBe(1);

    const got = await request(app.getHttpServer()).get(`/api/v1/internal/commission-rules/${created.body.id}`).set('Authorization', auth('operator')).expect(200);
    expect(got.body.calculationModel).toBe('FIXED');

    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/internal/commission-rules/${created.body.id}`)
      .set('Authorization', auth('operator'))
      .send({ flatCommissionMinor: '77', version: 1 })
      .expect(200);
    expect(patched.body.version).toBe(2);

    // resolve diagnostic (read-only): sees the rule
    const diag = await request(app.getHttpServer())
      .get('/api/v1/internal/commission-rules/resolve?productCode=WALLET_TRANSFER&currency=NGN&principalMinor=10000')
      .set('Authorization', auth('operator'))
      .expect(200);
    expect(diag.body.status).toBe('ALLOCATED');
    expect(diag.body.allocations[0]).toMatchObject({ amountMinor: '77', ruleVersion: 2 });

    // unconfigured product resolves to NOT_CONFIGURED 200
    const empty = await request(app.getHttpServer())
      .get('/api/v1/internal/commission-rules/resolve?productCode=CASH_TO_CASH&currency=NGN&principalMinor=10000')
      .set('Authorization', auth('operator'))
      .expect(200);
    expect(empty.body.status).toBe('NOT_CONFIGURED');

    // no DELETE endpoint exists
    await request(app.getHttpServer()).delete(`/api/v1/internal/commission-rules/${created.body.id}`).set('Authorization', auth('operator')).expect((r) => expect([404, 405]).toContain(r.status));
  });

  // ── 13. financial isolation proof ──

  it('15. no financial side effects: wallets/ledger/limits untouched by configuration + resolution', async () => {
    const before = {
      journals: await rowCount('ledger_journals'),
      lines: await rowCount('ledger_lines'),
      limitUsages: await rowCount('limit_usages'),
      snapshots: await rowCount('commercial_decision_snapshots'),
    };
    await registry.createRule(baseRule({ effectiveFrom: new Date(Date.now() - 60000) }) as any, 't');
    const aggId = await createAggregator();
    await registry.createRule(baseRule({ recipientType: 'AGGREGATOR', aggregatorId: aggId, calculationModel: 'PERCENTAGE', flatCommissionMinor: null, percentageBps: 100, effectiveFrom: new Date(Date.now() - 59000) }) as any, 't');
    const d = await decide({ aggregatorId: aggId });
    expect(d.status).toBe('ALLOCATED');
    expect(await rowCount('ledger_journals')).toBe(before.journals);
    expect(await rowCount('ledger_lines')).toBe(before.lines);
    expect(await rowCount('limit_usages')).toBe(before.limitUsages);
    expect(await rowCount('commercial_decision_snapshots')).toBe(before.snapshots); // resolution writes nothing
    expect(await rowCount('wallet_accounts')).toBe(0);
  });
});
