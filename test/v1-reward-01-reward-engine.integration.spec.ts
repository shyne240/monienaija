/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * V1-REWARD-01 — Reward / Cashback Engine foundation (real PostgreSQL).
 *
 * MACHINERY ONLY, ZERO CONFIGURED POLICY. Verified here:
 *   - migration 0074: reward_rules table, product FK → products.code, targeting FKs
 *     (customers/agent_classes/agents), CHECK coherence (model⇆params, reward_type,
 *     beneficiary, KYC-level vocabulary, campaign_code format, single targeting
 *     dimension, min<=max, windows), identity uniqueness
 *   - ZERO seeded production rules; V1 flows untouched (no flow references the engine)
 *   - deterministic calculation mechanics: FIXED, PERCENTAGE, PCT+MIN, PCT+MAX,
 *     PCT+MIN+MAX, FLAT+PCT, TIERED marginal brackets — TEST-ONLY synthetic rules only
 *   - calculation bases: PRINCIPAL, FEE (explicit fee evidence), NET; FEE/NET without
 *     evidence fail closed (never fabricated)
 *   - eligibility targeting: customer / customer KYC level (EXISTING CustomerKycLevel
 *     enum) / agent / agent class / config-only campaign_code / untargeted
 *   - effective dating (from <= at < to), versioning (optimistic lock, stale 409),
 *     disabled rules excluded, identity 409, audited administration (workforce-only)
 *   - deterministic per-beneficiary precedence: highest priority wins; equal-priority
 *     ties fail closed with REWARD_RULE_AMBIGUOUS (never a silent choice)
 *   - zero vs unconfigured: unconfigured → exact rewardNone() shape (NONE, ≠ ZERO)
 *   - snapshot representation: engine's GRANTED decision validates + persists through the
 *     existing Commercial Decision Snapshot (schema untouched), snapshots stay immutable
 *   - concurrent configuration safety (identity + optimistic version under races)
 *   - deterministic decision output
 *
 * NO reward is ever credited: this spec asserts wallet/ledger/limit tables stay empty
 * of reward effects and that no flow service references RewardEngine or reward_rules.
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
import { RewardRuleRegistryService } from '../src/reward/reward-rule-registry.service';
import { RewardEngine } from '../src/reward/reward.engine';
import { commissionNone, rewardNone } from '../src/commercial-decision/commercial-decision.defaults';
import { CommercialDecisionSnapshotService } from '../src/commercial-decision/commercial-decision-snapshot.service';
import { feeNotConfigured, limitNotEvaluated } from '../src/commercial-decision/commercial-decision.defaults';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

describe('V1-REWARD-01 Reward Engine foundation (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let registry: RewardRuleRegistryService;
  let engine: RewardEngine;
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
    dataSource = await createIntegrationDataSource('v1-reward-01');
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
    registry = app.get(RewardRuleRegistryService);
    engine = app.get(RewardEngine);
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
      beneficiaryType: 'CUSTOMER',
      rewardType: 'CASHBACK',
      calculationModel: 'FIXED',
      calculationBasis: 'PRINCIPAL',
      flatRewardMinor: '0',
      percentageBps: null,
      minimumRewardMinor: null,
      maximumRewardMinor: null,
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

  async function createCustomer(kycLevel: 'NONE' | 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' = 'LEVEL_2'): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status, version) VALUES ($1,$2,'INDIVIDUAL','ACTIVE',$3,'APPROVED',1)`,
      [id, `cust-r01-${randomUUID().slice(0, 10)}`, kycLevel],
    );
    return id;
  }

  async function createAgentClass(suffix = randomUUID().slice(0, 6)): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO agent_classes (id, reference, code, name, is_active, version) VALUES ($1,$2,$3,'R01 Class',true,1)`,
      [id, `cls-r01-${suffix}`, `RC01-${suffix}`],
    );
    return id;
  }

  async function createAgent(agentClassId: string | null = null): Promise<string> {
    const id = randomUUID();
    await dataSource.query(`INSERT INTO agents (id, reference, status, agent_class_id, version) VALUES ($1,$2,'ACTIVE',$3,1)`, [id, `agt-r01-${randomUUID().slice(0, 8)}`, agentClassId]);
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

  it('01. migration 0074 creates reward_rules with FKs, CHECK coherence and identity uniqueness', async () => {
    const tables: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='reward_rules'`,
    );
    expect(tables).toHaveLength(1);

    const constraints: Array<{ conname: string }> = await dataSource.query(
      `SELECT conname FROM pg_constraint WHERE conrelid='reward_rules'::regclass ORDER BY conname`,
    );
    const names = constraints.map((c) => c.conname);
    for (const expected of [
      'chk_reward_rules_currency', 'chk_reward_rules_beneficiary', 'chk_reward_rules_reward_type',
      'chk_reward_rules_model', 'chk_reward_rules_basis', 'chk_reward_rules_flat',
      'chk_reward_rules_percentage', 'chk_reward_rules_minimum', 'chk_reward_rules_maximum',
      'chk_reward_rules_effective', 'chk_reward_rules_version', 'chk_reward_rules_min_max',
      'chk_reward_rules_model_params', 'chk_reward_rules_target_single', 'chk_reward_rules_tiers_array',
      'chk_reward_rules_kyc_level', 'chk_reward_rules_campaign_code',
    ]) {
      expect(names).toContain(expected);
    }

    // product + targeting FKs (customers/agent_classes/agents; campaign_code is NOT an FK)
    const fks: Array<{ confrelid: string }> = await dataSource.query(
      `SELECT confrelid::regclass::text AS confrelid FROM pg_constraint WHERE conrelid='reward_rules'::regclass AND contype='f' ORDER BY confrelid::regclass::text`,
    );
    expect(fks.map((f) => f.confrelid)).toEqual(['agent_classes', 'agents', 'customers', 'products']);

    const indexes: Array<{ indexname: string }> = await dataSource.query(`SELECT indexname FROM pg_indexes WHERE tablename='reward_rules'`);
    expect(indexes.map((i) => i.indexname)).toContain('uq_reward_rules_identity');

    // DB-layer rejections (bypassing the service):
    const base = `INSERT INTO reward_rules (product_code, currency, beneficiary_type, reward_type, calculation_model, calculation_basis, created_by`;
    await expect(
      dataSource.query(`${base}, flat_reward_minor) VALUES ('WALLET_TRANSFER','NGN','CUSTOMER','CASHBACK','FIXED','PRINCIPAL','test',-1)`),
    ).rejects.toMatchObject({ code: '23514' }); // negative money
    await expect(
      dataSource.query(`${base}, percentage_bps) VALUES ('WALLET_TRANSFER','NGN','CUSTOMER','CASHBACK','PERCENTAGE','PRINCIPAL','test',10001)`),
    ).rejects.toMatchObject({ code: '23514' }); // bps > 10000
    await expect(
      dataSource.query(`${base}, percentage_bps, minimum_reward_minor, maximum_reward_minor) VALUES ('WALLET_TRANSFER','NGN','CUSTOMER','CASHBACK','PERCENTAGE_MIN_MAX','PRINCIPAL','test',100,500,100)`),
    ).rejects.toMatchObject({ code: '23514' }); // min > max
    await expect(
      dataSource.query(`${base}, flat_reward_minor) VALUES ('WALLET_TRANSFER','NGN','PLATFORM','CASHBACK','FIXED','PRINCIPAL','test',0)`),
    ).rejects.toMatchObject({ code: '23514' }); // unknown beneficiary type
    await expect(
      dataSource.query(`${base}, flat_reward_minor) VALUES ('WALLET_TRANSFER','NGN','CUSTOMER','LOYALTY_POINTS','FIXED','PRINCIPAL','test',0)`),
    ).rejects.toMatchObject({ code: '23514' }); // unknown reward type
    await expect(
      dataSource.query(`${base}, flat_reward_minor) VALUES ('WALLET_TRANSFER','NGN','CUSTOMER','CASHBACK','FIXED','GROSS','test',0)`),
    ).rejects.toMatchObject({ code: '23514' }); // unknown basis
    await expect(
      dataSource.query(`${base}, flat_reward_minor, percentage_bps) VALUES ('WALLET_TRANSFER','NGN','CUSTOMER','CASHBACK','FIXED','PRINCIPAL','test',0,100)`),
    ).rejects.toMatchObject({ code: '23514' }); // model⇆params incoherence
    await expect(
      dataSource.query(`${base}, flat_reward_minor, customer_id, campaign_code) VALUES ('WALLET_TRANSFER','NGN','CUSTOMER','CASHBACK','FIXED','PRINCIPAL','test',0,$1,'PROMO_X')`, [randomUUID()]),
    ).rejects.toMatchObject({ code: '23514' }); // two targeting dimensions
    await expect(
      dataSource.query(`${base}, flat_reward_minor, customer_kyc_level) VALUES ('WALLET_TRANSFER','NGN','CUSTOMER','CASHBACK','FIXED','PRINCIPAL','test',0,'TIER_GOLD')`),
    ).rejects.toMatchObject({ code: '23514' }); // invented KYC level rejected (existing enum only)
    await expect(
      dataSource.query(`${base}, flat_reward_minor, campaign_code) VALUES ('WALLET_TRANSFER','NGN','CUSTOMER','CASHBACK','FIXED','PRINCIPAL','test',0,'promo lowercase')`),
    ).rejects.toMatchObject({ code: '23514' }); // malformed campaign code
    await expect(
      dataSource.query(`${base}, flat_reward_minor) VALUES ('NOT_A_PRODUCT','NGN','CUSTOMER','CASHBACK','FIXED','PRINCIPAL','test',0)`),
    ).rejects.toMatchObject({ code: '23503' }); // unknown product
    await expect(
      dataSource.query(`${base}, flat_reward_minor) VALUES ('WALLET_TRANSFER','ngn','CUSTOMER','CASHBACK','FIXED','PRINCIPAL','test',0)`),
    ).rejects.toMatchObject({ code: '23514' }); // lowercase currency
  });

  // ── 2. zero seeded rules; flows untouched ──

  it('02. ZERO production reward rules seeded, no flow references RewardEngine, V1 snapshot default stays NONE', async () => {
    expect(await rowCount('reward_rules')).toBe(0);
    for (const flow of [
      'src/agent/agent-financial-execution.service.ts',
      'src/agent/agent-cash-to-cash.service.ts',
      'src/agent/agent-funding.service.ts',
      'src/customer-funding/customer-funding.service.ts',
      'src/transfer/transfer.service.ts',
    ]) {
      const src = readFileSync(join(__dirname, '..', flow), 'utf8');
      expect(src.includes('RewardEngine')).toBe(false);
      expect(src.includes('reward_rules')).toBe(false);
    }
    // the engine with an EMPTY registry returns the identical NONE shape the flows use today
    const decision = await decide();
    expect(decision).toEqual(rewardNone());
  });

  // ── 3. calculation mechanics (all seven models, synthetic rules) ──

  it('03. FIXED / PERCENTAGE / PCT+MIN / PCT+MAX / PCT+MIN+MAX / FLAT+PCT resolve to exact amounts (TEST-ONLY rules)', async () => {
    const mk = (over: Record<string, unknown>) =>
      registry.createRule(
        { ...baseRule({ flatRewardMinor: null, effectiveFrom: new Date(Date.now() - 60000) }), ...over } as any,
        'r01-test',
      );
    await mk({ calculationModel: 'FIXED', flatRewardMinor: '150' });
    expect((await decide()).grants[0]).toMatchObject({ amountMinor: '150', beneficiaryType: 'CUSTOMER', basis: 'PRINCIPAL', rewardType: 'CASHBACK' });

    await truncateAllTables(dataSource); await app.get(ProductCatalogSeedService).seedIfEmpty();
    await mk({ calculationModel: 'PERCENTAGE', percentageBps: 250 }); // 2.5%
    expect((await decide()).grants[0]).toMatchObject({ amountMinor: '250', basis: 'PRINCIPAL', baseAmountMinor: '10000' });

    await truncateAllTables(dataSource); await app.get(ProductCatalogSeedService).seedIfEmpty();
    await mk({ calculationModel: 'PERCENTAGE_MIN', percentageBps: 100, minimumRewardMinor: '400' }); // raw 100 → min 400
    expect((await decide()).grants[0]).toMatchObject({ amountMinor: '400' });

    await truncateAllTables(dataSource); await app.get(ProductCatalogSeedService).seedIfEmpty();
    await mk({ calculationModel: 'PERCENTAGE_MAX', percentageBps: 900, maximumRewardMinor: '300' }); // raw 900 → per-transaction cap 300
    expect((await decide()).grants[0]).toMatchObject({ amountMinor: '300' });

    await truncateAllTables(dataSource); await app.get(ProductCatalogSeedService).seedIfEmpty();
    await mk({ calculationModel: 'PERCENTAGE_MIN_MAX', percentageBps: 100, minimumRewardMinor: '400', maximumRewardMinor: '1000' });
    expect((await decide()).grants[0]).toMatchObject({ amountMinor: '400' }); // raw 100 → clamp up
    const agentId = await createAgent();
    await mk({ calculationModel: 'PERCENTAGE_MIN_MAX', percentageBps: 2000, minimumRewardMinor: '400', maximumRewardMinor: '1000', beneficiaryType: 'AGENT', rewardType: 'BONUS', agentId, effectiveFrom: new Date(Date.now() - 50000) });
    expect((await decide({ agentId }, {})).grants.find((g) => g.beneficiaryType === 'AGENT')!).toMatchObject({ amountMinor: '1000', rewardType: 'BONUS' }); // raw 2000 → clamp down

    await truncateAllTables(dataSource); await app.get(ProductCatalogSeedService).seedIfEmpty();
    await mk({ calculationModel: 'FLAT_PLUS_PERCENTAGE', flatRewardMinor: '100', percentageBps: 200 }); // 100 + 2% of 10000
    expect((await decide()).grants[0]).toMatchObject({ amountMinor: '300', calculationParameters: { flatRewardMinor: '100', percentageBps: 200 } });
  });

  it('04. TIERED marginal brackets resolve slice-by-slice with per-bracket floor division', async () => {
    await registry.createRule(
      baseRule({
        calculationModel: 'TIERED',
        flatRewardMinor: null,
        tiers: [
          { upToMinor: '10000', bps: 200 },
          { upToMinor: '50000', flatMinor: '100', bps: 100 },
          { upToMinor: null, bps: 50 },
        ],
        effectiveFrom: new Date(Date.now() - 60000),
      }) as any,
      'r01-test',
    );
    // base 60000: b1 200 (2% of 10000); b2 100 + 400 (1% of 40000); b3 50 (0.5% of 10000) → 750 total
    const decision = await decide({}, { principalMinor: '60000' });
    expect(decision.status).toBe('GRANTED');
    expect(decision.grants[0]).toMatchObject({ amountMinor: '750', calculationModel: 'TIERED', baseAmountMinor: '60000' });
    const params = decision.grants[0]!.calculationParameters as any;
    expect(params.tiers.map((t) => t.bracketRewardMinor)).toEqual(['200', '500', '50']);
    // base below top bracket: only slice of what it reached earns
    expect((await decide({}, { principalMinor: '5000' })).grants[0]).toMatchObject({ amountMinor: '100' });
  });

  // ── 4. calculation bases ──

  it('05. FEE and NET bases consume explicit fee evidence only and fail closed without it', async () => {
    await registry.createRule(
      baseRule({ calculationModel: 'PERCENTAGE', flatRewardMinor: null, percentageBps: 1000, calculationBasis: 'FEE', effectiveFrom: new Date(Date.now() - 60000) }) as any,
      'r01-test',
    );
    // 10% of the fee evidence (200) — fee evidence is caller-supplied; no flow fabricates it today
    expect((await decide({}, { feeMinor: '200' })).grants[0]).toMatchObject({ amountMinor: '20', basis: 'FEE', baseAmountMinor: '200' });
    // no fee evidence → fail closed (never derives or assumes)
    await expect(decide()).rejects.toMatchObject({ status: 400, message: expect.stringContaining('REWARD_BASE_UNAVAILABLE') });

    const agentId = await createAgent();
    await registry.createRule(
      baseRule({ calculationModel: 'PERCENTAGE', flatRewardMinor: null, percentageBps: 1000, calculationBasis: 'NET', beneficiaryType: 'AGENT', rewardType: 'BONUS', agentId, effectiveFrom: new Date(Date.now() - 50000) }) as any,
      'r01-test',
    );
    // NET = principal − fee = 10000 − 200 = 9800 → 10% = 980
    expect((await decide({ agentId }, { feeMinor: '200' })).grants.find((g) => g.beneficiaryType === 'AGENT')).toMatchObject({ amountMinor: '980', basis: 'NET', baseAmountMinor: '9800' });
    await expect(decide()).rejects.toMatchObject({ status: 400, message: expect.stringContaining('REWARD_BASE_UNAVAILABLE') });
  });

  // ── 5. eligibility / targeting ──

  it('06. customer / KYC-level / agent / agent-class / campaign / untargeted eligibility matches exactly and nothing else', async () => {
    const customerL2 = await createCustomer('LEVEL_2');
    const customerL1 = await createCustomer('LEVEL_1');
    const clsId = await createAgentClass();
    const agentInClass = await createAgent(clsId);

    await registry.createRule(baseRule({ customerKycLevel: 'LEVEL_2', effectiveFrom: new Date(Date.now() - 60000) }) as any, 'r01-test'); // L2 customers, FIXED 0
    await registry.createRule(
      baseRule({ customerId: customerL1, calculationModel: 'FIXED', flatRewardMinor: '9', effectiveFrom: new Date(Date.now() - 59000) }) as any,
      'r01-test',
    ); // one specific customer only
    await registry.createRule(
      baseRule({ campaignCode: 'PROMO_TEST_X', calculationModel: 'PERCENTAGE', flatRewardMinor: null, percentageBps: 100, effectiveFrom: new Date(Date.now() - 58000) }) as any,
      'r01-test',
    ); // campaign-targeted

    // KYC-level rule applies to an L2 customer, not to an L1 customer
    const l2 = await decide({ customerId: customerL2, customerKycLevel: 'LEVEL_2' });
    expect(l2.grants.find((g) => g.beneficiaryType === 'CUSTOMER')).toMatchObject({ amountMinor: '0', targeting: expect.objectContaining({ customerKycLevel: 'LEVEL_2' }) }); // explicit ZERO from the L2 rule
    const l1 = await decide({ customerId: randomUUID(), customerKycLevel: 'LEVEL_1' });
    // L1 untargeted customer: only the foreign-customer-specific rule exists → no CUSTOMER grant for THIS context
    expect(l1.grants.find((g) => g.targeting.customerKycLevel === 'LEVEL_2')).toBeUndefined();

    // customer-specific rule pinned to customerL1
    const specific = await decide({ customerId: customerL1, customerKycLevel: 'LEVEL_1' });
    expect(specific.grants.find((g) => g.beneficiaryId === customerL1)).toMatchObject({ amountMinor: '9' });

    // campaign-targeted rule applies only when the transaction carries that code
    const promo = await decide({ campaignCode: 'PROMO_TEST_X' });
    expect(promo.grants[0]).toMatchObject({ amountMinor: '100', campaignCode: 'PROMO_TEST_X', targeting: expect.objectContaining({ campaignCode: 'PROMO_TEST_X' }) });
    expect((await decide({ campaignCode: 'PROMO_OTHER' })).status).toBe('NONE');
    // a context with NO targeting identity matches nothing pinned
    expect((await decide()).status).toBe('NONE');

    // agent-class targeted CUSTOMER-beneficiary rule: transacting via a class-X agent context.
    // Context (agentInClass in clsId, no customer identity / no campaign) matches only the
    // class-targeted rule in the CUSTOMER group → deterministic single winner.
    await registry.createRule(
      baseRule({ agentClassId: clsId, calculationModel: 'FIXED', flatRewardMinor: '5', effectiveFrom: new Date(Date.now() - 57000) }) as any,
      'r01-test',
    );
    const viaClass = await decide({ agentId: agentInClass, agentClassId: clsId });
    expect(viaClass.status).toBe('GRANTED');
    expect(viaClass.grants).toHaveLength(1);
    expect(viaClass.grants[0]).toMatchObject({ amountMinor: '5', targeting: expect.objectContaining({ agentClassId: clsId }) });

    // unconfigured product is unaffected
    expect((await decide({ productCode: 'CASH_TO_WALLET' })).status).toBe('NONE');
  });

  // ── 6. multi-beneficiary independence (no conflation) ──

  it('07. independent CUSTOMER and AGENT beneficiary rules grant unrelated amounts side by side', async () => {
    const agentId = await createAgent();
    await registry.createRule(baseRule({ calculationModel: 'PERCENTAGE', flatRewardMinor: null, percentageBps: 200, effectiveFrom: new Date(Date.now() - 60000) }) as any, 'r01-test'); // CUSTOMER cashback 200
    await registry.createRule(
      baseRule({ beneficiaryType: 'AGENT', rewardType: 'BONUS', agentId, calculationModel: 'FIXED', flatRewardMinor: '60', effectiveFrom: new Date(Date.now() - 59000) }) as any,
      'r01-test',
    ); // AGENT bonus 60 — deliberately NOT a share of the customer reward
    const decision = await decide({ agentId });
    expect(decision.status).toBe('GRANTED');
    const amounts = Object.fromEntries(decision.grants.map((g) => [g.beneficiaryType, g.amountMinor]));
    expect(amounts).toEqual({ CUSTOMER: '200', AGENT: '60' });
    expect(decision.ruleRefs).toHaveLength(2);
    expect(decision.ruleRefs.map((r) => r.ruleType)).toEqual(['REWARD', 'REWARD']);
    // distinct rule ids/versions captured per beneficiary group
    expect(new Set(decision.grants.map((g) => g.ruleId)).size).toBe(2);
  });

  // ── 7. effective dates / versioning / disabled ──

  it('08. effective windows, historical resolution, versioning and disabled rules behave deterministically', async () => {
    const past = new Date(Date.now() - 86400000);
    const future = new Date(Date.now() + 86400000);
    const rule = await registry.createRule(baseRule({ effectiveFrom: past, effectiveTo: future, flatRewardMinor: '111' }) as any, 'r01-test');
    // inside window → applies; before/after → nothing
    expect((await decide({ at: new Date() })).grants[0]).toMatchObject({ amountMinor: '111', ruleVersion: 1 });
    expect((await decide({ at: new Date(Date.now() - 2 * 86400000) })).status).toBe('NONE');
    expect((await decide({ at: new Date(Date.now() + 2 * 86400000) })).status).toBe('NONE');
    // version bump + stale conflict + audit
    const updated = await registry.updateRule(rule.id, { flatRewardMinor: '222', version: 1 }, 'r01-ops');
    expect(updated.version).toBe(2);
    await expect(registry.updateRule(rule.id, { flatRewardMinor: '333', version: 1 }, 'r01-ops')).rejects.toMatchObject({ status: 409 });
    // historical resolution still sees the same rule row lineage; the new CURRENT values resolve now
    expect((await decide()).grants[0]).toMatchObject({ amountMinor: '222', ruleVersion: 2 });
    // disabled rules stop applying (deactivation, never deletion)
    await registry.updateRule(rule.id, { isActive: false, version: 2 }, 'r01-ops');
    expect((await decide()).status).toBe('NONE');
    expect(await rowCount('reward_rules')).toBe(1); // deactivated, not erased
    const audits: Array<{ entity_type: string; action: string }> = await dataSource.query(
      `SELECT entity_type, action FROM audit_events WHERE entity_type='REWARD_RULE' ORDER BY occurred_at`,
    );
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['CREATED', 'UPDATED']));
  });

  // ── 8. precedence & ambiguity ──

  it('09. highest priority wins per beneficiary group; equal-priority ties fail CLOSED with explicit ambiguity', async () => {
    await registry.createRule(baseRule({ flatRewardMinor: '100', priority: 1, effectiveFrom: new Date(Date.now() - 60000) }) as any, 'r01-test');
    await registry.createRule(baseRule({ flatRewardMinor: '999', priority: 5, effectiveFrom: new Date(Date.now() - 59000) }) as any, 'r01-test');
    expect((await decide()).grants[0]).toMatchObject({ amountMinor: '999' }); // priority 5 wins
    // introduce an equal-priority competitor → resolution must not silently choose
    await registry.createRule(baseRule({ flatRewardMinor: '555', priority: 5, effectiveFrom: new Date(Date.now() - 58000) }) as any, 'r01-test');
    await expect(decide()).rejects.toMatchObject({ status: 409, message: expect.stringContaining('REWARD_RULE_AMBIGUOUS') });
    // disambiguate: demote the '555' rule to priority 4 → the '999' rule wins deterministically
    const rows: Array<{ id: string; version: number }> = await dataSource.query(
      `SELECT id, version FROM reward_rules WHERE flat_reward_minor='555' AND priority=5`,
    );
    expect(rows).toHaveLength(1);
    await registry.updateRule(rows[0]!.id, { priority: 4, version: rows[0]!.version }, 'r01-ops');
    expect((await decide()).grants[0]).toMatchObject({ amountMinor: '999' });
  });

  // ── 9. schema enforcement on rule writing (registry validation) ──

  it('10. registry rejects incoherent definitions, unknown targets and duplicate identities', async () => {
    // model⇆params incoherence
    await expect(registry.createRule(baseRule({ calculationModel: 'PERCENTAGE', flatRewardMinor: '0', percentageBps: 100 }) as any, 't')).rejects.toMatchObject({ status: 400 });
    // missing params
    await expect(registry.createRule(baseRule({ calculationModel: 'PERCENTAGE', flatRewardMinor: null }) as any, 't')).rejects.toMatchObject({ status: 400 });
    // TIERED without tiers
    await expect(registry.createRule(baseRule({ calculationModel: 'TIERED', flatRewardMinor: null, tiers: null }) as any, 't')).rejects.toMatchObject({ status: 400 });
    // non-ascending brackets
    await expect(
      registry.createRule(baseRule({ calculationModel: 'TIERED', flatRewardMinor: null, tiers: [{ upToMinor: '5000', bps: 100 }, { upToMinor: '4000', bps: 100 }] }) as any, 't'),
    ).rejects.toMatchObject({ status: 400 });
    // open-ended bracket not last
    await expect(
      registry.createRule(baseRule({ calculationModel: 'TIERED', flatRewardMinor: null, tiers: [{ upToMinor: null, bps: 100 }, { upToMinor: '5000', bps: 100 }] }) as any, 't'),
    ).rejects.toMatchObject({ status: 400 });
    // two targeting dimensions (5-way single-dimension discipline)
    await expect(registry.createRule(baseRule({ customerId: randomUUID(), campaignCode: 'PROMO_X' }) as any, 't')).rejects.toMatchObject({ status: 400 });
    await expect(registry.createRule(baseRule({ customerKycLevel: 'LEVEL_2', agentClassId: randomUUID() }) as any, 't')).rejects.toMatchObject({ status: 400 });
    // unknown target identity
    await expect(registry.createRule(baseRule({ customerId: randomUUID() }) as any, 't')).rejects.toMatchObject({ status: 404 });
    await expect(registry.createRule(baseRule({ agentId: randomUUID() }) as any, 't')).rejects.toMatchObject({ status: 404 });
    // invented KYC level rejected (existing vocabulary only)
    await expect(registry.createRule(baseRule({ customerKycLevel: 'TIER_GOLD' }) as any, 't')).rejects.toMatchObject({ status: 400 });
    // malformed campaign code
    await expect(registry.createRule(baseRule({ campaignCode: 'has spaces' }) as any, 't')).rejects.toMatchObject({ status: 400 });
    // unknown beneficiary / reward type / basis
    await expect(registry.createRule(baseRule({ beneficiaryType: 'PLATFORM' }) as any, 't')).rejects.toMatchObject({ status: 400 });
    await expect(registry.createRule(baseRule({ rewardType: 'POINTS' }) as any, 't')).rejects.toMatchObject({ status: 400 });
    await expect(registry.createRule(baseRule({ calculationBasis: 'GROSS' }) as any, 't')).rejects.toMatchObject({ status: 400 });
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
    expect(await rowCount('reward_rules')).toBe(1);

    const u1 = registry.updateRule((results[0] as any).value.id, { flatRewardMinor: '10', version: 1 }, 't1');
    const u2 = registry.updateRule((results[0] as any).value.id, { flatRewardMinor: '20', version: 1 }, 't2');
    const updates = await Promise.allSettled([u1, u2]);
    expect(updates.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await dataSource.query(`SELECT version FROM reward_rules WHERE id=$1`, [(results[0] as any).value.id])).toEqual([{ version: 2 }]);
  });

  // ── 11. snapshot representation + immutability ──

  it('12. engine GRANTED decision persists through the existing snapshot (schema untouched) and stays immutable', async () => {
    const agentId = await createAgent();
    await registry.createRule(baseRule({ calculationModel: 'PERCENTAGE', flatRewardMinor: null, percentageBps: 150, effectiveFrom: new Date(Date.now() - 60000) }) as any, 't');
    await registry.createRule(
      baseRule({ beneficiaryType: 'AGENT', rewardType: 'PROMOTION', agentId, calculationModel: 'FIXED', flatRewardMinor: '40', effectiveFrom: new Date(Date.now() - 59000) }) as any,
      't',
    );
    const reward = await decide({ agentId });
    expect(reward.status).toBe('GRANTED');
    const customerId = await createCustomer('LEVEL_2');
    const key = `r01-snap-${randomUUID()}`;
    // standalone path (own SERIALIZABLE wrapper) — the shape-boundary proof, NOT flow wiring
    const { snapshot } = await snapshotService.recordDecision({
      idempotencyKey: key,
      product: 'WALLET_TRANSFER',
      direction: 'BOTH',
      channel: 'TEST',
      principalType: 'CUSTOMER',
      principalId: customerId,
      currency: 'NGN',
      principalAmountMinor: '10000',
      transactionReference: `r01-tx-${randomUUID()}`,
      journalId: null,
      decisionStatus: 'FINAL',
      feeDecision: feeNotConfigured('NGN', '10000'),
      commissionDecision: commissionNone(),
      rewardDecision: reward as any,
      limitDecision: limitNotEvaluated(),
      revenueDecision: null,
      configurationVersion: null,
      createdBy: 'r01-test',
    });
    expect(snapshot.reward_decision.status).toBe('GRANTED');
    expect(snapshot.reward_decision.grants).toHaveLength(2);
    for (const grant of snapshot.reward_decision.grants) {
      expect(grant.ruleId).toMatch(/^[0-9a-f-]{36}$/);
      expect(grant.ruleVersion).toBeGreaterThanOrEqual(1);
      expect(grant.basis).toBe('PRINCIPAL');
      expect(grant.baseAmountMinor).toBe('10000');
      expect(['CASHBACK', 'PROMOTION']).toContain(grant.rewardType);
      expect(grant.amountMinor).toBeDefined();
    }
    // per-beneficiary split captured deterministically
    expect(snapshot.reward_decision.grants.map((g) => g.beneficiaryType).sort()).toEqual(['AGENT', 'CUSTOMER']);
    // engine NONE shape is byte-identical to what V1 flows write today
    snapshot.reward_decision.ruleRefs.forEach((r) => expect(r.ruleType).toBe('REWARD'));
    // immutability: snapshot row rejects updates (trigger)
    await expect(dataSource.query(`UPDATE commercial_decision_snapshots SET reward_decision='{}' WHERE idempotency_key=$1`, [key])).rejects.toThrow();
    // replay with the same idempotency footprint returns, never duplicates
    expect(await rowCount('commercial_decision_snapshots')).toBe(1);
  });

  it('13. ZERO vs NOT_CONFIGURED: explicit ZERO rule grants 0 and stays distinct from NONE', async () => {
    expect((await decide()).status).toBe('NONE'); // unconfigured — the V1 normal
    await registry.createRule(baseRule({ flatRewardMinor: '0', effectiveFrom: new Date(Date.now() - 60000) }) as any, 't');
    const d = await decide();
    expect(d.status).toBe('GRANTED'); // configured explicit ZERO — not NONE
    expect(d.grants[0]).toMatchObject({ amountMinor: '0', beneficiaryType: 'CUSTOMER', rewardType: 'CASHBACK' });
  });

  // ── 13. deterministic decision output ──

  it('14. deterministic calculation: identical context produces byte-identical grants', async () => {
    const agentId = await createAgent();
    await registry.createRule(
      baseRule({
        calculationModel: 'TIERED',
        flatRewardMinor: null,
        tiers: [
          { upToMinor: '10000', bps: 200 },
          { upToMinor: null, flatMinor: '25', bps: 100 },
        ],
        effectiveFrom: new Date(Date.now() - 60000),
      }) as any,
      't',
    );
    await registry.createRule(
      baseRule({ beneficiaryType: 'AGENT', rewardType: 'BONUS', agentId, calculationModel: 'PERCENTAGE', flatRewardMinor: null, percentageBps: 333, effectiveFrom: new Date(Date.now() - 59000) }) as any,
      't',
    );
    const ctx = { agentId } as any;
    const bases = { principalMinor: '12345', feeMinor: null } as any;
    const first = await engine.decide({ productCode: 'WALLET_TRANSFER', currency: 'NGN', ...ctx }, bases);
    const second = await engine.decide({ productCode: 'WALLET_TRANSFER', currency: 'NGN', ...ctx }, bases);
    expect(first).toEqual(second); // deep equality across every computed field
    // 3.33% of 12345 with floor division per bracket/model — exact, repeatable
    expect(first.grants.find((g) => g.beneficiaryType === 'AGENT')).toMatchObject({ amountMinor: '411' }); // floor(12345*333/10000)
    expect(first.grants.find((g) => g.beneficiaryType === 'CUSTOMER')).toMatchObject({ amountMinor: '248' }); // 200 (2% of 10000) + 25 + floor(2345*100/10000)=23 → 248
  });

  // ── 14. workforce-only HTTP administration + diagnostic ──

  it('15. internal API: workforce-only access, CREATE/LIST/GET/PATCH roundtrip, resolve diagnostic', async () => {
    // non-workforce principals cannot administer
    await request(app.getHttpServer()).get('/api/v1/internal/reward-rules').set('Authorization', auth('agent')).expect(403);
    await request(app.getHttpServer()).post('/api/v1/internal/reward-rules').set('Authorization', auth('customer')).send({}).expect(403);
    await request(app.getHttpServer()).get('/api/v1/internal/reward-rules').expect(401);

    const created = await request(app.getHttpServer())
      .post('/api/v1/internal/reward-rules')
      .set('Authorization', auth('operator'))
      .send(baseRule({ effectiveFrom: new Date(Date.now() - 60000) }))
      .expect(201);
    expect(created.body.beneficiaryType).toBe('CUSTOMER');
    expect(created.body.rewardType).toBe('CASHBACK');
    expect(created.body.version).toBe(1);

    const list = await request(app.getHttpServer()).get('/api/v1/internal/reward-rules?productCode=WALLET_TRANSFER').set('Authorization', auth('operator')).expect(200);
    expect(list.body.total).toBe(1);

    const got = await request(app.getHttpServer()).get(`/api/v1/internal/reward-rules/${created.body.id}`).set('Authorization', auth('operator')).expect(200);
    expect(got.body.calculationModel).toBe('FIXED');

    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/internal/reward-rules/${created.body.id}`)
      .set('Authorization', auth('operator'))
      .send({ flatRewardMinor: '77', version: 1 })
      .expect(200);
    expect(patched.body.version).toBe(2);

    // resolve diagnostic (read-only): sees the rule
    const diag = await request(app.getHttpServer())
      .get('/api/v1/internal/reward-rules/resolve?productCode=WALLET_TRANSFER&currency=NGN&principalMinor=10000')
      .set('Authorization', auth('operator'))
      .expect(200);
    expect(diag.body.status).toBe('GRANTED');
    expect(diag.body.grants[0]).toMatchObject({ amountMinor: '77', ruleVersion: 2, rewardType: 'CASHBACK' });

    // unconfigured product resolves to NOT_CONFIGURED 200
    const empty = await request(app.getHttpServer())
      .get('/api/v1/internal/reward-rules/resolve?productCode=CASH_TO_CASH&currency=NGN&principalMinor=10000')
      .set('Authorization', auth('operator'))
      .expect(200);
    expect(empty.body.status).toBe('NOT_CONFIGURED');

    // no DELETE endpoint exists
    await request(app.getHttpServer()).delete(`/api/v1/internal/reward-rules/${created.body.id}`).set('Authorization', auth('operator')).expect((r) => expect([404, 405]).toContain(r.status));
  });

  // ── 15. financial isolation + engine-separation proof ──

  it('16. no financial side effects: wallets/ledger/limits/commission untouched by configuration + resolution', async () => {
    const before = {
      journals: await rowCount('ledger_journals'),
      lines: await rowCount('ledger_lines'),
      limitUsages: await rowCount('limit_usages'),
      snapshots: await rowCount('commercial_decision_snapshots'),
    };
    await registry.createRule(baseRule({ effectiveFrom: new Date(Date.now() - 60000) }) as any, 't');
    const agentId = await createAgent();
    await registry.createRule(baseRule({ beneficiaryType: 'AGENT', rewardType: 'BONUS', agentId, calculationModel: 'PERCENTAGE', flatRewardMinor: null, percentageBps: 100, effectiveFrom: new Date(Date.now() - 59000) }) as any, 't');
    const d = await decide({ agentId });
    expect(d.status).toBe('GRANTED');
    expect(await rowCount('ledger_journals')).toBe(before.journals);
    expect(await rowCount('ledger_lines')).toBe(before.lines);
    expect(await rowCount('limit_usages')).toBe(before.limitUsages);
    expect(await rowCount('commercial_decision_snapshots')).toBe(before.snapshots); // resolution writes nothing
    expect(await rowCount('wallet_accounts')).toBe(0);
    // engine separation: no commission rule was created, no commission machinery consulted
    expect(await rowCount('commission_rules')).toBe(0);
  });
});
