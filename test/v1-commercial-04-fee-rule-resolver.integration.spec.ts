/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * V1-COMMERCIAL-04 — Fee Rule RESOLUTION foundation (real PostgreSQL).
 *
 * READ-ONLY FOUNDATION. Verified here:
 *   - resolve(productCode, currency, at) → RESOLVED | NOT_CONFIGURED | AMBIGUOUS
 *   - exact product + currency matching (no conversion; V1 is NGN-only)
 *   - inactive and soft-deleted rules are never applicable
 *   - single interval convention: effective_from <= at < effective_to; open-ended when effective_to is null
 *   - priority convention: highest number wins (matches LimitProfileResolverService precedence DESC)
 *   - same-priority ties → explicit deterministic AMBIGUOUS, never a silent pick
 *   - historical resolution: windowed rules answer past timestamps; before any window → NOT_CONFIGURED
 *   - NOT_CONFIGURED ≠ explicit zero-fee rule (flat_fee_minor = 0 resolves as RESOLVED)
 *   - workforce-only read-only diagnostic route; safe failure for invalid/unknown products
 *   - ZERO financial mutation: wallets, ledger, limits, reservations, snapshots untouched
 *
 * All fee rules used here are synthetic TEST rows created through the registry service or SQL;
 * the production fee_rules table remains EMPTY (zero seeded rules).
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { FeeRuleResolverService } from '../src/fee-rules/fee-rule-resolver.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

describe('V1-COMMERCIAL-04 Fee Rule Resolution foundation (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let registry: FeeRuleRegistryService;
  let resolver: FeeRuleResolverService;

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
    dataSource = await createIntegrationDataSource('v1-comm-04');
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
    registry = app.get(FeeRuleRegistryService);
    resolver = app.get(FeeRuleResolverService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await app.get(ProductCatalogSeedService).seedIfEmpty();
  });

  // synthetic TEST values only — never seeded production policy
  function baseRule(overrides: Record<string, unknown> = {}) {
    return {
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      flatFeeMinor: '100',
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

  const T1 = '2030-01-01T00:00:00.000Z';
  const T2 = '2030-02-01T00:00:00.000Z';

  // ── 1. NOT_CONFIGURED is the default V1 state ──

  it('01. no rules → NOT_CONFIGURED (never an exception)', async () => {
    expect(await registry.countRules()).toBe(0);
    const r = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date() });
    expect(r.status).toBe('NOT_CONFIGURED');
    expect(r.productCode).toBe('WALLET_TRANSFER');
    expect(r.currency).toBe('NGN');
    expect(r.rule).toBeUndefined();
  });

  it('02. product mismatch → NOT_CONFIGURED', async () => {
    await registry.createRule(baseRule({ productCode: 'WALLET_TRANSFER' }), 'test');
    const r = await resolver.resolve({ productCode: 'AGENT_FUNDING', currency: 'NGN', at: new Date() });
    expect(r.status).toBe('NOT_CONFIGURED');
  });

  it('03. currency mismatch → NOT_CONFIGURED (exact match, no conversion)', async () => {
    await registry.createRule(baseRule({ currency: 'NGN' }), 'test');
    for (const c of ['USD', 'GBP', 'EUR']) {
      const r = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: c, at: new Date() });
      expect(r.status).toBe('NOT_CONFIGURED');
    }
  });

  it('04. inactive rules are ignored', async () => {
    const created = await registry.createRule(baseRule(), 'test');
    await registry.updateRule(created.id, { isActive: false, version: 1 }, 'test');
    const r = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date() });
    expect(r.status).toBe('NOT_CONFIGURED');
  });

  it('05. soft-deleted rules are ignored', async () => {
    const created = await registry.createRule(baseRule(), 'test');
    await dataSource.query(`UPDATE fee_rules SET deleted_at = NOW() WHERE id = $1`, [created.id]);
    const r = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date() });
    expect(r.status).toBe('NOT_CONFIGURED');
  });

  it('06. effective_from boundary: at == effective_from is included, one ms earlier is not', async () => {
    await registry.createRule(baseRule({ effectiveFrom: T1 }), 'test');
    const included = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date(T1) });
    expect(included.status).toBe('RESOLVED');
    const excluded = await resolver.resolve({
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      at: new Date(new Date(T1).getTime() - 1),
    });
    expect(excluded.status).toBe('NOT_CONFIGURED');
  });

  it('07. effective_to boundary: at == effective_to is excluded, one ms earlier is included', async () => {
    await registry.createRule(baseRule({ effectiveFrom: T1, effectiveTo: T2 }), 'test');
    const included = await resolver.resolve({
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      at: new Date(new Date(T2).getTime() - 1),
    });
    expect(included.status).toBe('RESOLVED');
    const excluded = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date(T2) });
    expect(excluded.status).toBe('NOT_CONFIGURED');
  });

  it('08. open-ended rule (no effective_to) resolves for any at >= effective_from', async () => {
    await registry.createRule(baseRule({ effectiveFrom: T1 }), 'test');
    for (const at of ['2030-01-01T00:00:00.000Z', '2031-06-15T12:00:00.000Z', '2099-12-31T23:59:59.999Z']) {
      const r = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date(at) });
      expect(r.status).toBe('RESOLVED');
    }
  });

  it('09. single applicable rule → RESOLVED with exact ruleId, version and fee parameters', async () => {
    const created = await registry.createRule(
      baseRule({ flatFeeMinor: '1500', percentageBps: 25, minimumFeeMinor: '100', maximumFeeMinor: '90000', vatBps: 750 }),
      'test',
    );
    const r = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date() });
    expect(r.status).toBe('RESOLVED');
    expect(r.rule).toEqual({
      ruleId: created.id,
      ruleVersion: 1,
      flatFeeMinor: '1500',
      percentageBps: 25,
      minimumFeeMinor: '100',
      maximumFeeMinor: '90000',
      vatBps: 750,
      effectiveFrom: expect.any(Date),
      effectiveTo: null,
      priority: 0,
    });
    // manager-bound variant returns the identical resolution (future flow-integration primitive)
    const rm = await resolver.resolveWithManager(dataSource.manager, { productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date() });
    expect(rm.status).toBe('RESOLVED');
    expect(rm.rule!.ruleId).toBe(created.id);
    expect(rm.rule!.ruleVersion).toBe(1);
  });

  it('10. multiple applicable rules → highest priority wins (established convention)', async () => {
    await registry.createRule(baseRule({ effectiveFrom: T1, priority: 5, flatFeeMinor: '111' }), 'test');
    const mid = await registry.createRule(baseRule({ effectiveFrom: '2030-01-10T00:00:00.000Z', priority: 10, flatFeeMinor: '222' }), 'test');
    await registry.createRule(baseRule({ effectiveFrom: '2030-01-20T00:00:00.000Z', priority: 20, flatFeeMinor: '333' }), 'test');
    // all three applicable at 2030-03-01 → priority 20 wins (not the earliest, not the lowest number)
    const winner = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date('2030-03-01T00:00:00.000Z') });
    expect(winner.status).toBe('RESOLVED');
    expect(winner.rule!.priority).toBe(20);
    expect(winner.rule!.flatFeeMinor).toBe('333');
    // before the priority-20 window opens, priority-10 is the highest applicable
    const earlier = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date('2030-01-15T00:00:00.000Z') });
    expect(earlier.status).toBe('RESOLVED');
    expect(earlier.rule!.ruleId).toBe(mid.id);
    expect(earlier.rule!.priority).toBe(10);
  });

  it('11. same-priority ambiguity → explicit deterministic AMBIGUOUS, never a silent pick', async () => {
    const a = await registry.createRule(baseRule({ effectiveFrom: T1, priority: 5, flatFeeMinor: '111' }), 'test');
    const b = await registry.createRule(baseRule({ effectiveFrom: T2, priority: 5, flatFeeMinor: '222' }), 'test');
    const both = [a.id, b.id].sort();
    for (let i = 0; i < 5; i += 1) {
      const r = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date('2030-03-01T00:00:00.000Z') });
      expect(r.status).toBe('AMBIGUOUS');
      expect(r.ambiguousRuleIds).toEqual(both); // deterministic report, sorted — never a selection
      expect(r.ambiguousPriority).toBe(5);
      expect(r.rule).toBeUndefined();
    }
    // a lower-priority rule applicable at the same time does not hide the ambiguity
    await registry.createRule(baseRule({ effectiveFrom: '2030-01-05T00:00:00.000Z', priority: 1, flatFeeMinor: '999' }), 'test');
    const still = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date('2030-03-01T00:00:00.000Z') });
    expect(still.status).toBe('AMBIGUOUS');
    expect(still.ambiguousRuleIds).toEqual(both);
  });

  it('12. historical resolution: windowed rules answer past timestamps; current state never leaks in', async () => {
    const v1 = await registry.createRule(baseRule({ effectiveFrom: T1, effectiveTo: T2, flatFeeMinor: '100' }), 'test');
    const v2 = await registry.createRule(baseRule({ effectiveFrom: T2, flatFeeMinor: '200' }), 'test');
    // before any window → NOT_CONFIGURED
    expect((await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date('2029-12-31T23:59:59.999Z') })).status).toBe('NOT_CONFIGURED');
    // inside v1 window → v1
    const r1 = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date('2030-01-15T00:00:00.000Z') });
    expect(r1.status).toBe('RESOLVED');
    expect(r1.rule!.ruleId).toBe(v1.id);
    expect(r1.rule!.ruleVersion).toBe(1);
    expect(r1.rule!.flatFeeMinor).toBe('100');
    // exactly at the window seam → v2 (effective_from <= at < effective_to)
    const r2 = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date(T2) });
    expect(r2.status).toBe('RESOLVED');
    expect(r2.rule!.ruleId).toBe(v2.id);
    expect(r2.rule!.flatFeeMinor).toBe('200');
    // mutate the CURRENT rule (v2 params + version bump) …
    const updated = await registry.updateRule(v2.id, { flatFeeMinor: '777', version: 1 }, 'test');
    expect(updated.version).toBe(2);
    // … and the HISTORICAL window still resolves to v1 with unchanged parameters —
    // the resolver selects the applicable row at `at`, it never re-reads "current" state afterwards
    const r3 = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date('2030-01-15T00:00:00.000Z') });
    expect(r3.status).toBe('RESOLVED');
    expect(r3.rule!.ruleId).toBe(v1.id);
    expect(r3.rule!.flatFeeMinor).toBe('100');
    // deactivating the current rule does not rewrite history either
    await registry.updateRule(v2.id, { isActive: false, version: 2 }, 'test');
    const r4 = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date('2030-01-15T00:00:00.000Z') });
    expect(r4.status).toBe('RESOLVED');
    expect(r4.rule!.ruleId).toBe(v1.id);
    // after v2's window: now NOT_CONFIGURED (v2 inactive) — the result follows applicability at `at`
    const r5 = await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date('2030-03-01T00:00:00.000Z') });
    expect(r5.status).toBe('NOT_CONFIGURED');
  });

  it('13. overlapping effective windows: different priorities resolve, same priority is ambiguous', async () => {
    // overlap with distinct priorities
    await registry.createRule(baseRule({ productCode: 'AGENT_FUNDING', effectiveFrom: T1, priority: 10, flatFeeMinor: '10' }), 'test');
    const higher = await registry.createRule(baseRule({ productCode: 'AGENT_FUNDING', effectiveFrom: T2, priority: 20, flatFeeMinor: '20' }), 'test');
    const overlapped = await resolver.resolve({ productCode: 'AGENT_FUNDING', currency: 'NGN', at: new Date('2030-06-01T00:00:00.000Z') });
    expect(overlapped.status).toBe('RESOLVED');
    expect(overlapped.rule!.ruleId).toBe(higher.id);
    // overlap with the SAME priority → explicit ambiguity
    await registry.createRule(baseRule({ productCode: 'AGENT_FUNDING', effectiveFrom: '2030-03-01T00:00:00.000Z', priority: 20, flatFeeMinor: '30' }), 'test');
    const ambiguous = await resolver.resolve({ productCode: 'AGENT_FUNDING', currency: 'NGN', at: new Date('2030-06-01T00:00:00.000Z') });
    expect(ambiguous.status).toBe('AMBIGUOUS');
    expect(ambiguous.ambiguousRuleIds!.length).toBe(2);
    expect(ambiguous.ambiguousRuleIds).toContain(higher.id);
  });

  it('14. resolution is deterministic across repeated calls and input formats', async () => {
    const created = await registry.createRule(baseRule({ effectiveFrom: T1 }), 'test');
    const results = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      const r = await resolver.resolve({ productCode: 'wallet_transfer', currency: 'ngn', at: '2030-05-05T05:05:05.000Z' });
      expect(r.status).toBe('RESOLVED');
      expect(r.rule!.ruleId).toBe(created.id);
      expect(r.productCode).toBe('WALLET_TRANSFER'); // normalized against the catalogue identity
      expect(r.currency).toBe('NGN');
      results.add(JSON.stringify(r.rule));
    }
    expect(results.size).toBe(1);
  });

  it('15. safe failure for invalid/unknown products: malformed 400, unknown catalogue product NOT_CONFIGURED', async () => {
    await expect(resolver.resolve({ productCode: '', currency: 'NGN' })).rejects.toThrow('productCode is required');
    await expect(resolver.resolve({ productCode: 'bad code!', currency: 'NGN' })).rejects.toThrow('productCode must match');
    await expect(resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NAIRA' })).rejects.toThrow('currency must be a 3-letter');
    await expect(resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: 'not-a-date' })).rejects.toThrow('at must be a valid date');
    // syntactically valid but not in the authoritative catalogue → deterministic NOT_CONFIGURED, no exception
    const unknown = await resolver.resolve({ productCode: 'NO_SUCH_PRODUCT', currency: 'NGN', at: new Date() });
    expect(unknown.status).toBe('NOT_CONFIGURED');
  });

  it('16. NOT_CONFIGURED ≠ ZERO: an explicit zero-fee rule resolves as RESOLVED with flatFeeMinor 0', async () => {
    const free = await registry.createRule(baseRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '0', percentageBps: null }), 'test');
    const r = await resolver.resolve({ productCode: 'WALLET_TO_CASH', currency: 'NGN', at: new Date() });
    expect(r.status).toBe('RESOLVED');
    expect(r.rule!.ruleId).toBe(free.id);
    expect(r.rule!.flatFeeMinor).toBe('0');
    // a product with NO rule at all is NOT_CONFIGURED — a distinct semantic
    const none = await resolver.resolve({ productCode: 'CASH_TO_CASH', currency: 'NGN', at: new Date() });
    expect(none.status).toBe('NOT_CONFIGURED');
    expect(none.rule).toBeUndefined();
  });

  it('17. workforce-only read-only diagnostic route GET /internal/fee-rules/resolve', async () => {
    const created = await registry.createRule(baseRule({ flatFeeMinor: '250' }), 'test');
    // unauthenticated
    await request(app.getHttpServer()).get('/api/v1/internal/fee-rules/resolve?productCode=WALLET_TRANSFER').expect(401);
    // non-workforce principals
    for (const t of ['customer', 'agent', 'aggregator', 'support']) {
      await request(app.getHttpServer())
        .get('/api/v1/internal/fee-rules/resolve?productCode=WALLET_TRANSFER')
        .set('Authorization', auth(t))
        .expect(403);
    }
    // workforce roles allowed (OPERATOR/SERVICE/PRIVILEGED)
    for (const t of ['operator', 'service', 'privileged']) {
      const res = await request(app.getHttpServer())
        .get('/api/v1/internal/fee-rules/resolve?productCode=WALLET_TRANSFER&currency=NGN')
        .set('Authorization', auth(t))
        .expect(200);
      expect(res.body.status).toBe('RESOLVED');
      expect(res.body.rule.ruleId).toBe(created.id);
      expect(res.body.rule.ruleVersion).toBe(1);
      expect(res.body.rule.flatFeeMinor).toBe('250');
      expect(res.body.productCode).toBe('WALLET_TRANSFER');
    }
    // NOT_CONFIGURED is a normal 200 answer
    const empty = await request(app.getHttpServer())
      .get('/api/v1/internal/fee-rules/resolve?productCode=AGENT_FUNDING')
      .set('Authorization', auth('operator'))
      .expect(200);
    expect(empty.body.status).toBe('NOT_CONFIGURED');
    // explicit `at` parameter drives historical resolution over HTTP too
    const past = await request(app.getHttpServer())
      .get(`/api/v1/internal/fee-rules/resolve?productCode=WALLET_TRANSFER&at=2020-01-01T00:00:00.000Z`)
      .set('Authorization', auth('operator'))
      .expect(200);
    expect(past.body.status).toBe('NOT_CONFIGURED'); // rule is effective from now, not in 2020
    // input validation
    await request(app.getHttpServer())
      .get('/api/v1/internal/fee-rules/resolve')
      .set('Authorization', auth('operator'))
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/internal/fee-rules/resolve?productCode=WALLET_TRANSFER&at=nope')
      .set('Authorization', auth('operator'))
      .expect(400);
    // the static resolve route must not shadow (nor be shadowed by) fee-rules/:id
    await request(app.getHttpServer())
      .get(`/api/v1/internal/fee-rules/${created.id}`)
      .set('Authorization', auth('operator'))
      .expect(200);
  });

  it('18. the resolver is read-only: zero mutation of wallets, ledger, limits, reservations, snapshots', async () => {
    await registry.createRule(baseRule({ effectiveFrom: T1 }), 'test');
    await registry.createRule(baseRule({ productCode: 'AGENT_FUNDING', effectiveFrom: T1, effectiveTo: T2, priority: 5 }), 'test');
    const before = await financialTables();
    for (let i = 0; i < 25; i += 1) {
      await resolver.resolve({ productCode: 'WALLET_TRANSFER', currency: 'NGN', at: new Date('2030-06-01T00:00:00.000Z') });
      await resolver.resolve({ productCode: 'AGENT_FUNDING', currency: 'NGN', at: new Date('2030-01-15T00:00:00.000Z') });
      await resolver.resolve({ productCode: 'NO_SUCH_PRODUCT', currency: 'NGN', at: new Date() });
    }
    const after = await financialTables();
    expect(after).toEqual(before);
  });

  it('19. production seed proof + resolver wiring boundary (source-level)', async () => {
    // zero seeded fee rules after a full application bootstrap
    expect(await registry.countRules()).toBe(0);
    const products: Array<{ configuration_status: string }> = await dataSource.query(
      `SELECT configuration_status FROM products ORDER BY code`,
    );
    expect(products.length).toBe(7);
    for (const p of products) expect(p.configuration_status).toBe('NOT_CONFIGURED');
    // Resolver wiring boundary (updated with each pilot; justified reality, never weakened):
    //  - V1-COMMERCIAL-DECISION-02: WALLET_TRANSFER via TransferService
    //  - V1-COMMERCIAL-DECISION-03A/03B: CASH_TO_WALLET + WALLET_TO_CASH via the shared
    //    AgentFinancialExecutionService (the cash-in/cash-out ORCHESTRATORS stay unwired)
    //  - V1-COMMERCIAL-DECISION-03C: CASH_TO_CASH initiation + claim via their own services
    //  - V1-COMMERCIAL-DECISION-03D: CUSTOMER_FUNDING via the approve boundary
    //  - V1-COMMERCIAL-DECISION-03E: AGENT_FUNDING + AGENT_DEFUNDING via AgentFundingService
    // All seven V1 products are now covered; only orchestrators without their own money path
    // (cash-in/cash-out) remain resolver-free.
    for (const flow of [
      '../src/agent/agent-cash-in.service.ts',
      '../src/agent/agent-cash-out.service.ts',
    ]) {
      const source = readFileSync(join(__dirname, flow), 'utf8');
      expect(source).not.toContain('FeeRuleResolverService');
      expect(source).not.toContain('resolveWithManager');
    }
    // each wired service consumes the resolver as EVIDENCE ONLY — no calculation/charging
    for (const flow of [
      '../src/agent/agent-financial-execution.service.ts',
      '../src/agent/agent-cash-to-cash.service.ts',
      '../src/agent/agent-cash-to-cash-claim.service.ts',
      '../src/customer-funding/customer-funding.service.ts',
      '../src/agent/agent-funding.service.ts',
    ]) {
      const source = readFileSync(join(__dirname, flow), 'utf8');
      expect(source).toContain('resolveWithManager'); // read-only resolution inside the tx
      expect(source).toContain('recordDecisionWithManager'); // snapshot joins the SAME tx
      expect(source).not.toMatch(/\.recordDecision\(/); // never the second-transaction variant
      expect(source).not.toContain('feeEngine'); // no FeeEngine participation
      expect(source).not.toContain('calculate('); // no fee calculation
    }
    // the pilot wiring is evidence-only: no fee calculation/charging anywhere in TransferService
    const transferSource = readFileSync(join(__dirname, '../src/transfer/transfer.service.ts'), 'utf8');
    expect(transferSource).toContain('resolveWithManager'); // read-only resolution inside the tx
    expect(transferSource).toContain('recordDecisionWithManager'); // snapshot joins the SAME tx
    expect(transferSource).not.toMatch(/\.recordDecision\(/); // never the second-transaction variant
    expect(transferSource).not.toContain('feeEngine'); // no FeeEngine participation
    expect(transferSource).not.toContain('calculate('); // no fee calculation
    // the resolver itself never writes: no INSERT/UPDATE/DELETE anywhere in the service
    const resolverSource = readFileSync(join(__dirname, '../src/fee-rules/fee-rule-resolver.service.ts'), 'utf8');
    expect(resolverSource).not.toContain('INSERT INTO');
    expect(resolverSource).not.toContain('UPDATE ');
    expect(resolverSource).not.toContain('DELETE FROM');
  });
});
