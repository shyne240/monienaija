/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { CapabilityService } from '../src/capability-registry/capability.service';
import { CAPABILITY_SEED } from '../src/capability-registry/capability.seed';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('V1-CAPABILITY-REGISTRY-01 — Capability Registry (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let capabilityService: CapabilityService;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    jwksJson: [],
    // @ts-ignore
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-')) throw new UnauthorizedException('invalid workforce token');
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED', 'AGENT', 'CUSTOMER', 'AGGREGATOR', 'FINANCE_PREPARER', 'FINANCE_CONTROLLER'];
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

  function workforceToken(type: string): string {
    return `workforce-${type}`;
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-capability-registry');
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
    await app.getHttpAdapter().getInstance().ready();
    capabilityService = moduleRef.get(CapabilityService);
    // ensure seed
    const count = await capabilityService.count();
    if (count === 0) {
      for (const item of CAPABILITY_SEED) await capabilityService.create(item as never).catch(() => undefined);
    }
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try { if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined); } catch { void 0; }
      }
    }
  }, 60000);

  beforeEach(async () => {
    // do not truncate capabilities; truncate other tables but keep capabilities and migrations and ledger_accounts
    const rows: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('typeorm_migrations','ledger_accounts','capabilities')`,
    );
    if (rows.length) {
      const list = rows.map((r) => `"${r.tablename}"`).join(', ');
      await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    }
    const settlement: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    if (settlement.length === 0) {
      await dataSource.query(`
        INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
        VALUES
          ('00000000-0000-4000-8000-000000000201','PAYMENT-SETTLEMENT_ASSET-NGN','Payment settlement asset NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
          ('00000000-0000-4000-8000-000000000202','PAYMENT-SETTLEMENT_CLEARING-NGN','Payment settlement clearing NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
          ('00000000-0000-4000-8000-000000000203','PAYMENT-SYSTEM_SUSPENSE-NGN','Payment system suspense NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE),
          ('00000000-0000-4000-8000-000000000001','AGENT_FUNDING_POOL-NGN','Agent funding pool NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE),
          ('00000000-0000-4000-8000-000000000002','CASH_TO_CASH-UNCLAIMED-NGN','Cash to cash unclaimed NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE)
        ON CONFLICT (code) DO NOTHING
      `);
    }
    // re-seed capabilities if empty (truncate cascading may have cleared? capabilities not truncated so should persist)
    const cnt = await capabilityService.count();
    if (cnt === 0) {
      for (const item of CAPABILITY_SEED) await capabilityService.create(item as never).catch(() => undefined);
    } else if (cnt < CAPABILITY_SEED.length) {
      // upsert missing
      for (const item of CAPABILITY_SEED) {
        try { await capabilityService.findByCode(item.capabilityCode); } catch { await capabilityService.create(item as never).catch(() => undefined); }
      }
    }
  });

  // helpers
  async function countJournals(): Promise<number> {
    const rows: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    return Number(rows[0]!.cnt);
  }

  // ── Migration & chain ──
  it('01. Migration count and chain intact (additive chain)', async () => {
    const rows: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM typeorm_migrations`);
    expect(Number(rows[0]!.cnt)).toBe(79);
    const files: Array<{ name: string }> = await dataSource.query(`SELECT name FROM typeorm_migrations ORDER BY name`);
    expect(files.length).toBe(79);
    expect(files.some((f) => f.name.includes('1785753600075'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600074'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600072'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600071'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600070'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600069'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600068'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600067'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600066'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600065'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600000'))).toBe(true);
    const latest: Array<{ timestamp: string; name: string }> = await dataSource.query(`SELECT timestamp::text as timestamp, name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(latest[0]!.timestamp).toBe('1785753600078');
    expect(latest[0]!.name).toBe('CreateCustomerRegistrationPhoneChallenges1785753600078');
  });

  // ── Seed counts V1/V2 ──
  it('02. Seed count matches CAPABILITY_SEED and V1/V2 breakdown', async () => {
    const total = await capabilityService.count();
    expect(total).toBe(CAPABILITY_SEED.length);
    expect(total).toBeGreaterThanOrEqual(80);
    const v1 = CAPABILITY_SEED.filter((c) => c.productScope === 'V1').length;
    const v2 = CAPABILITY_SEED.filter((c) => c.productScope === 'V2').length;
    expect(v1 + v2).toBe(total);
    // live DB via API summary
    const summary = await request(app.getHttpServer()).get('/api/v1/internal/capabilities/summary').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(summary.body.total).toBe(total);
    expect(summary.body.v1).toBe(v1);
    expect(summary.body.v2).toBe(v2);
  });

  // ── Creation / unique / status ──
  it('03. Service create validates and unique constraint', async () => {
    const code = `TEST_CAP_${randomUUID().slice(0,8).toUpperCase().replace(/-/g,'A')}`;
    const input = {
      capabilityCode: code,
      domain: 'PLATFORM',
      name: 'Test cap',
      description: 'Test description',
      productScope: 'V1',
      lifecycle: 'PLANNED',
      backendStatus: 'PLANNED',
      apiStatus: 'NOT_EXPOSED',
      adminUiStatus: 'NOT_EXPOSED',
      customerUiStatus: 'NOT_EXPOSED',
      agentUiStatus: 'NOT_EXPOSED',
      enabled: false,
      configurationStatus: 'NOT_CONFIGURED',
      dependencies: null,
      implementationReferences: null,
      migrationReferences: null,
      testReferences: null,
      documentationReferences: null,
      version: 1,
      owner: 'Test',
      blockerType: 'NONE',
      blockerDescription: null,
      notes: null,
    } as any;
    const created = await capabilityService.create(input);
    expect(created.capabilityCode).toBe(code);
    expect(created.enabled).toBe(false);
    await expect(capabilityService.create(input)).rejects.toThrow(/already exists/);
    // invalid code pattern
    await expect(capabilityService.create({ ...input, capabilityCode: 'ab' })).rejects.toThrow(/capabilityCode/);
    await expect(capabilityService.create({ ...input, capabilityCode: 'lowercase' })).rejects.toThrow(/capabilityCode/);
    // invalid enum
    await expect(capabilityService.create({ ...input, capabilityCode: `${code}B`, domain: 'INVALID' })).rejects.toThrow(/domain/);
    await expect(capabilityService.create({ ...input, capabilityCode: `${code}C`, productScope: 'V3' })).rejects.toThrow(/productScope/);
    // version <1
    await expect(capabilityService.create({ ...input, capabilityCode: `${code}D`, version: 0 })).rejects.toThrow(/version/);
    // cleanup
    await dataSource.query(`DELETE FROM capabilities WHERE capability_code=$1`, [code]);
  });

  it('04. enabled vs configured independent — FEE_ENGINE disabled but backend implemented', async () => {
    const fee = await capabilityService.findByCode('FEE_ENGINE');
    expect(fee.backendStatus).toBe('BACKEND_IMPLEMENTED');
    expect(fee.enabled).toBe(false);
    expect(fee.configurationStatus).toBe('NOT_CONFIGURED');
    expect(fee.lifecycle).toBe('DISABLED');
    const wallet = await capabilityService.findByCode('CUSTOMER_WALLET');
    expect(wallet.enabled).toBe(true);
    expect(wallet.configurationStatus).toBe('CONFIGURED');
    expect(wallet.backendStatus).toBe('BACKEND_IMPLEMENTED');
  });

  it('05. backend vs UI distinction — CUSTOMER_BENEFICIARIES backend only, WALLET_TO_WALLET fully enabled', async () => {
    const ben = await capabilityService.findByCode('CUSTOMER_BENEFICIARIES');
    expect(ben.backendStatus).toBe('BACKEND_IMPLEMENTED');
    expect(ben.apiStatus).toBe('NOT_EXPOSED');
    expect(ben.customerUiStatus).toBe('NOT_EXPOSED');
    expect(ben.enabled).toBe(false);
    const w2w = await capabilityService.findByCode('WALLET_TO_WALLET');
    expect(w2w.backendStatus).toBe('BACKEND_IMPLEMENTED');
    expect(w2w.apiStatus).toBe('API_READY');
    expect(w2w.customerUiStatus).toBe('CUSTOMER_UI_READY');
    expect(w2w.enabled).toBe(true);
  });

  it('06. dependencies and refs are stored', async () => {
    const c2c = await capabilityService.findByCode('CASH_TO_CASH');
    expect(c2c.dependencies).toContain('AGENT_WALLET');
    const w2w = await capabilityService.findByCode('WALLET_TO_WALLET');
    expect(w2w.implementationReferences?.some((r) => r.includes('transfer.service.ts'))).toBe(true);
    expect(w2w.migrationReferences?.some((r) => r.includes('CreateWalletAndLedger'))).toBe(true);
    expect(w2w.testReferences?.some((r) => r.includes('a23-customer-app'))).toBe(true);
    expect(w2w.documentationReferences?.some((r) => r.includes('V1-HARDENING'))).toBe(true);
  });

  it('07. Commercial statuses accurate', async () => {
    const product = await capabilityService.findByCode('PRODUCT_CATALOGUE');
    // V1-COMMERCIAL-02: catalogue foundation implemented + seeded; NOT runtime-enabled (no commercial
    // rule system references it yet), and fee/commission/reward engines stay untouched
    expect(product.lifecycle).toBe('BACKEND_IMPLEMENTED');
    expect(product.backendStatus).toBe('BACKEND_IMPLEMENTED');
    expect(product.apiStatus).toBe('API_READY');
    expect(product.configurationStatus).toBe('CONFIGURED');
    expect(product.enabled).toBe(false);
    // V1-LIMIT-04: runtime limit enforcement wired into financial flows
    const limit = await capabilityService.findByCode('LIMIT_ENGINE');
    expect(limit.backendStatus).toBe('BACKEND_IMPLEMENTED');
    expect(limit.enabled).toBe(true);
    expect(limit.lifecycle).toBe('FULLY_ENABLED');
    expect(limit.configurationStatus).toBe('CONFIGURED');
    const customerLimits = await capabilityService.findByCode('CUSTOMER_RUNTIME_LIMITS');
    expect(customerLimits.backendStatus).toBe('BACKEND_IMPLEMENTED');
    expect(customerLimits.lifecycle).toBe('FULLY_ENABLED');
    expect(customerLimits.enabled).toBe(true);
    const agentLimits = await capabilityService.findByCode('AGENT_RUNTIME_LIMITS');
    expect(agentLimits.backendStatus).toBe('BACKEND_IMPLEMENTED');
    expect(agentLimits.lifecycle).toBe('FULLY_ENABLED');
    expect(agentLimits.enabled).toBe(true);
    const snapshot = await capabilityService.findByCode('COMMERCIAL_DECISION_SNAPSHOT');
    // V1-COMMERCIAL-DECISION-02: pilot runtime capture live for WALLET_TRANSFER only —
    // atomic in-flow snapshot recording with fee NOT_CONFIGURED and zero charging.
    // NOT full commercial pricing: 7 other flows remain future work.
    expect(snapshot.backendStatus).toBe('BACKEND_IMPLEMENTED');
    expect(snapshot.lifecycle).toBe('API_READY');
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.configurationStatus).toBe('NOT_CONFIGURED');
  });

  it('08. V2 blocked — WALLET_TO_BANK and AIR followed', async () => {
    const w2b = await capabilityService.findByCode('WALLET_TO_BANK');
    expect(w2b.productScope).toBe('V2');
    expect(w2b.blockerType).toBe('V2');
    const airtime = await capabilityService.findByCode('AIRTIME');
    expect(airtime.productScope).toBe('V2');
    const nibss = await capabilityService.findByCode('NIBSS_INTEGRATION');
    expect(nibss.blockerType).toBe('EXTERNAL_DEPENDENCY');
  });

  // ── API list/get/filter/pagination/auth/safe projection ──
  it('09. GET /internal/capabilities unauthenticated 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities').expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities/summary').expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities/WALLET_TO_WALLET').expect(401);
  });

  it('10. GET /internal/capabilities CUSTOMER and AGENT denied 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities').set('Authorization', `Bearer ${workforceToken('CUSTOMER')}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities').set('Authorization', `Bearer ${workforceToken('AGENT')}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities').set('Authorization', `Bearer ${workforceToken('AGGREGATOR')}`).expect(401);
  });

  it('11. GET /internal/capabilities WORKFORCE allowed SUPPORT/OPERATOR/SERVICE/PRIVILEGED', async () => {
    for (const role of ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED']) {
      const res = await request(app.getHttpServer()).get('/api/v1/internal/capabilities').set('Authorization', `Bearer ${workforceToken(role)}`).expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.total).toBeGreaterThan(0);
    }
  });

  it('12. GET /internal/capabilities pagination deterministic page1 limit20 max100', async () => {
    const r1 = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?page=1&limit=5').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(r1.body.data.length).toBe(5);
    expect(r1.body.page).toBe(1);
    expect(r1.body.limit).toBe(5);
    expect(r1.body.total).toBe(CAPABILITY_SEED.length);
    expect(r1.body.totalPages).toBe(Math.ceil(CAPABILITY_SEED.length/5));
    expect(typeof r1.body.hasNextPage).toBe('boolean');
    const r2 = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?page=2&limit=5').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(r2.body.data[0].capabilityCode).not.toBe(r1.body.data[0].capabilityCode);
    // deterministic ASC
    const all = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?page=1&limit=100').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const codes = all.body.data.map((c:any)=>c.capabilityCode);
    const sorted = [...codes].sort();
    expect(codes).toEqual(sorted);
  });

  it('13. GET /internal/capabilities filtering', async () => {
    const v1 = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?productScope=V1').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(v1.body.data.every((c:any)=>c.productScope==='V1')).toBe(true);
    const v2 = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?productScope=V2').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(v2.body.data.every((c:any)=>c.productScope==='V2')).toBe(true);
    expect(v1.body.total + v2.body.total).toBe(CAPABILITY_SEED.length);
    const commercial = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?domain=COMMERCIAL').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(commercial.body.total).toBeGreaterThanOrEqual(27);
    expect(commercial.body.data.every((c:any)=>c.domain==='COMMERCIAL')).toBe(true);
    const enabledTrue = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?enabled=true').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(enabledTrue.body.data.every((c:any)=>c.enabled===true)).toBe(true);
    const enabledFalse = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?enabled=false').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(enabledFalse.body.data.every((c:any)=>c.enabled===false)).toBe(true);
    expect(enabledTrue.body.total + enabledFalse.body.total).toBe(CAPABILITY_SEED.length);
    const blocked = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?blockerType=V2').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(blocked.body.data.every((c:any)=>c.blockerType==='V2')).toBe(true);
    expect(blocked.body.total).toBeGreaterThan(0);
    const backendPlanned = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?backendStatus=PLANNED').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(backendPlanned.body.data.every((c:any)=>c.backendStatus==='PLANNED')).toBe(true);
    // combined filter
    const combined = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?productScope=V2&blockerType=V2').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(combined.body.data.every((c:any)=>c.productScope==='V2' && c.blockerType==='V2')).toBe(true);
  });

  it('14. GET /internal/capabilities/:code success', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/internal/capabilities/WALLET_TO_WALLET').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(res.body.capabilityCode).toBe('WALLET_TO_WALLET');
    expect(res.body.domain).toBe('WALLET');
    expect(res.body.name).toBeTruthy();
    expect(res.body.description).toBeTruthy();
    expect(res.body.productScope).toBe('V1');
    expect(res.body.version).toBeGreaterThan(0);
    expect(res.body.createdAt).toBeTruthy();
    expect(res.body.updatedAt).toBeTruthy();
  });

  it('15. GET /internal/capabilities/:code 404 not found and 400 invalid code', async () => {
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities/NOT_EXIST_123').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(404);
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities/ab').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities/lowercase').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(400);
  });

  it('16. GET /internal/capabilities safe projection — no leak', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?limit=5').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const str = JSON.stringify(res.body).toLowerCase();
    expect(str).not.toContain('password');
    expect(str).not.toContain('pinhash');
    expect(str).not.toContain('tokenhash');
    // implementationReferences legitimately contains 'CreateWalletAndLedger' — do not check 'ledger' substring
    expect(str).not.toContain('ophash');
    expect(str).not.toContain('secret');
    // ensure safe projection does not expose internal ledgerAccountId etc — capability registry has none
    expect(str).not.toContain('ledgeraccountid');
    expect(str).not.toContain('hash_algo');
    // required fields present
    for (const item of res.body.data) {
      expect(item).toHaveProperty('capabilityCode');
      expect(item).toHaveProperty('domain');
      expect(item).toHaveProperty('productScope');
      expect(item).toHaveProperty('lifecycle');
      expect(item).toHaveProperty('backendStatus');
      expect(item).toHaveProperty('apiStatus');
      expect(item).toHaveProperty('enabled');
      expect(item).toHaveProperty('configurationStatus');
      expect(item).toHaveProperty('blockerType');
      expect(item).not.toHaveProperty('password');
    }
  });

  it('17. GET /internal/capabilities pagination validation', async () => {
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities?page=0').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities?limit=0').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities?limit=101').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities?enabled=maybe').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(400);
  });

  it('18. GET /internal/capabilities/summary derived correctly', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/internal/capabilities/summary').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    // derive manually via service
    const expected = await capabilityService.summary();
    expect(res.body).toEqual(expected);
    expect(res.body.total).toBe(CAPABILITY_SEED.length);
    expect(res.body.v1 + res.body.v2).toBe(res.body.total);
    expect(res.body.fullyEnabled + res.body.backendOnly).toBeLessThanOrEqual(res.body.total);
    expect(res.body.planned).toBeGreaterThan(0);
    expect(res.body.blocked).toBeGreaterThan(0);
    expect(res.body.byDomain).toBeDefined();
    expect(res.body.byBackendStatus).toBeDefined();
    // check specific derived semantics
    // fullyEnabled = enabled && configured && backendImplemented
    const all = CAPABILITY_SEED;
    const manualFully = all.filter((c) => c.enabled && c.configurationStatus==='CONFIGURED' && c.backendStatus==='BACKEND_IMPLEMENTED').length;
    expect(res.body.fullyEnabled).toBe(manualFully);
    // V2 count manual
    const manualV2 = all.filter((c)=>c.productScope==='V2').length;
    expect(res.body.v2).toBe(manualV2);
  });

  it('19. GET /internal/capabilities filtering by lifecycle and domain', async () => {
    const planned = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?lifecycle=PLANNED').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(planned.body.data.every((c:any)=>c.lifecycle==='PLANNED')).toBe(true);
    const agent = await request(app.getHttpServer()).get('/api/v1/internal/capabilities?domain=AGENT').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(agent.body.data.every((c:any)=>c.domain==='AGENT')).toBe(true);
    expect(agent.body.total).toBe(8); // AGENT domain strictly 8 (others under WALLET/IDENTITY)
  });

  it('20. No POST/DELETE on /internal/capabilities (read-only)', async () => {
    await request(app.getHttpServer()).post('/api/v1/internal/capabilities').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).send({}).expect(404);
    await request(app.getHttpServer()).delete('/api/v1/internal/capabilities').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(404);
    await request(app.getHttpServer()).patch('/api/v1/internal/capabilities/WALLET_TO_WALLET').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).send({}).expect(404);
  });

  it('21. Financial safety — capability reads do not touch ledger', async () => {
    const before = await countJournals();
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities/summary').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    await request(app.getHttpServer()).get('/api/v1/internal/capabilities/WALLET_TO_WALLET').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const after = await countJournals();
    expect(after).toBe(before);
  });

  it('22. Capability 16 questions answered — WALLET_TO_WALLET spot check', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/internal/capabilities/WALLET_TO_WALLET').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    // 1 name/description
    expect(r.body.name).toBeTruthy();
    expect(r.body.description).toBeTruthy();
    // 2 backend
    expect(r.body.backendStatus).toBe('BACKEND_IMPLEMENTED');
    // 3 api
    expect(r.body.apiStatus).toBe('API_READY');
    // 4 admin
    expect(r.body.adminUiStatus).toBe('ADMIN_UI_READY');
    // 5 customer
    expect(r.body.customerUiStatus).toBe('CUSTOMER_UI_READY');
    // 6 agent
    expect(r.body.agentUiStatus).toBe('NOT_EXPOSED');
    // 7 configured
    expect(r.body.configurationStatus).toBe('CONFIGURED');
    // 8 enabled
    expect(r.body.enabled).toBe(true);
    // 9 blocked
    expect(r.body.blockerType).toBe('NONE');
    // 10 dependencies
    expect(r.body.dependencies).toContain('CUSTOMER_WALLET');
    // 11 implementation
    expect(r.body.implementationReferences?.join(',')).toContain('transfer.service.ts');
    // 12 migration
    expect(r.body.migrationReferences?.join(',')).toContain('CreateWalletAndLedger');
    // 13 test
    expect(r.body.testReferences?.join(',')).toContain('a23-customer-app');
    // 14 docs
    expect(r.body.documentationReferences?.join(',')).toContain('.md');
    // 15 V1/V2
    expect(r.body.productScope).toBe('V1');
    // 16 lifecycle
    expect(r.body.lifecycle).toBe('FULLY_ENABLED');
  });
});
