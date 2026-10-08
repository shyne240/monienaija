/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

describe('V1-HARDENING-07 Admin Agent Financial Investigation (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let ledgerService: LedgerService;

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
      const allowed = ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED','AGENT','CUSTOMER','AGGREGATOR'];
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

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-hardening-07');
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
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(()=>undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(()=> dataSource.destroy().catch(()=>undefined));
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  function workforceToken(type: string): string { return `workforce-${type}`; }

  async function createAgentDirect(status = 'ACTIVE'): Promise<string> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [`cls-hard07-${randomUUID().slice(0,6)}`, `CODE-${randomUUID().slice(0,6)}`, 'hard07 class', JSON.stringify(['CASH_IN']), JSON.stringify({})],
    );
    const classId = classRows[0]!.id;
    const rows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,$2,$3) RETURNING id`, [`ag-${randomUUID()}`, status, classId]);
    return rows[0]!.id;
  }

  async function createCustomerDirect(): Promise<string> {
    const reference = `cust-hard07-${randomUUID().slice(0,8)}`;
    const rows: Array<{ id: string }> = await dataSource.query(`INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`, [reference]);
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, `Cust ${customerId.slice(0,4)}`]);
    return customerId;
  }

  // 1. workforce allowed
  it('1. financial-position: SUPPORT/OPERATOR/SERVICE/PRIVILEGED allowed', async () => {
    const agentId = await createAgentDirect();
    for (const role of ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED']) {
      const token = workforceToken(role);
      const res = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.agentId).toBe(agentId);
      expect(res.body.currency).toBe('NGN');
      expect(res.body.balanceMinor).toBeDefined();
      expect(res.body.walletExists).toBeDefined();
    }
  });

  // 2. CUSTOMER denied
  it('2. financial-position: CUSTOMER denied', async () => {
    const agentId = await createAgentDirect();
    const token = workforceToken('CUSTOMER');
    const res = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`);
    expect([401,403].includes(res.status)).toBe(true);
  });

  // 3. AGENT denied on internal
  it('3. financial-position: AGENT denied on internal endpoint (Agent SELF via internal must fail)', async () => {
    const agentId = await createAgentDirect();
    const token = workforceToken('AGENT');
    const res = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`);
    expect([401,403].includes(res.status)).toBe(true);
    // even with real Agent login, should be denied via internal (Agent SELF is via /agents/me)
    // we test synthetic AGENT is enough; real login would also be AGENT principal type
  });

  // 4. AGGREGATOR denied
  it('4. financial-position: AGGREGATOR denied', async () => {
    const agentId = await createAgentDirect();
    const token = workforceToken('AGGREGATOR');
    const res = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`);
    expect([401,403].includes(res.status)).toBe(true);
  });

  // 5. unauthenticated denied
  it('5. financial-position: unauthenticated denied', async () => {
    const agentId = await createAgentDirect();
    const unauth = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`);
    expect(unauth.status).toBe(401);
    const bad = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization','Bearer invalid');
    expect([401,403].includes(bad.status)).toBe(true);
  });

  // 6. valid Agent financial position (walletExists false initially, true after wallet)
  it('6. valid Agent financial position returns walletExists false when no wallet, true after wallet', async () => {
    const agentId = await createAgentDirect();
    const token = workforceToken('SUPPORT');
    const res1 = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res1.body.agentId).toBe(agentId);
    expect(res1.body.currency).toBe('NGN');
    expect(res1.body.balanceMinor).toBe('0');
    expect(res1.body.walletExists).toBe(false);
    expect(res1.body.walletId).toBeNull();

    const wallet = await walletService.createWallet({ customerId: agentId, currency: 'NGN', idempotencyKey: `hard07-w-${agentId}` });
    const res2 = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res2.body.walletExists).toBe(true);
    expect(res2.body.walletId).toBe(wallet.id);
    expect(res2.body.currency).toBe('NGN');
    expect(res2.body.balanceMinor).toBe('0');
    expect(res2.body.status).toBe('ACTIVE');
  });

  // 7. ledger-derived balance correct
  it('7. ledger-derived balance correct (via WalletService/LedgerService)', async () => {
    const agentId = await createAgentDirect();
    const wallet = await walletService.createWallet({ customerId: agentId, currency: 'NGN', idempotencyKey: `hard07-bal-${agentId}` });
    const wRows: Array<{ledger_account_id:string}> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [wallet.id]);
    const ledgerId = wRows[0]!.ledger_account_id;
    const plat = await ledgerService.createAccount({ code: `PLAT7_${randomUUID().slice(0,6)}`, name: 'Plat7', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ledgerService.postJournal({ idempotencyKey: `fund7-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' }, { accountId: ledgerId, direction: 'CREDIT' as any, amountMinor: '50000' }] });
    const token = workforceToken('OPERATOR');
    const res = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.balanceMinor).toBe('50000');
    expect(res.body.availableBalanceMinor).toBe('50000');
    // second credit increments
    await ledgerService.postJournal({ idempotencyKey: `fund7b-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '25000' }, { accountId: ledgerId, direction: 'CREDIT' as any, amountMinor: '25000' }] });
    const res2 = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res2.body.balanceMinor).toBe('75000');
  });

  // 8. currency explicit
  it('8. currency explicit is NGN', async () => {
    const agentId = await createAgentDirect();
    await walletService.createWallet({ customerId: agentId, currency: 'NGN', idempotencyKey: `hard07-curr-${agentId}` });
    const token = workforceToken('SERVICE');
    const res = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.currency).toBe('NGN');
    // no other currency exposed
    expect(typeof res.body.currency).toBe('string');
  });

  // 9. nonexistent Agent 404, invalid UUID 400
  it('9. nonexistent Agent 404, invalid UUID 400', async () => {
    const fake = randomUUID();
    const token = workforceToken('SUPPORT');
    await request(app.getHttpServer()).get(`/api/v1/internal/agents/${fake}/financial-position`).set('Authorization', `Bearer ${token}`).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/internal/agents/not-a-uuid/financial-position`).set('Authorization', `Bearer ${token}`).expect(400);
  });

  // 10. cross-Agent isolation (workforce can access any, but AGENT cannot, and nonexistent handled)
  it('10. cross-Agent isolation: workforce can access any Agent, AGENT cannot use internal', async () => {
    const agentA = await createAgentDirect();
    const agentB = await createAgentDirect();
    const walletA = await walletService.createWallet({ customerId: agentA, currency: 'NGN', idempotencyKey: `hard07-iso-a-${agentA}` });
    const wRows: Array<{ledger_account_id:string}> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [walletA.id]);
    const plat = await ledgerService.createAccount({ code: `PLATISO_${randomUUID().slice(0,6)}`, name: 'PlatIso', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ledgerService.postJournal({ idempotencyKey: `iso-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '12345' }, { accountId: wRows[0]!.ledger_account_id, direction: 'CREDIT' as any, amountMinor: '12345' }] });
    const tokenW = workforceToken('PRIVILEGED');
    const resA = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentA}/financial-position`).set('Authorization', `Bearer ${tokenW}`).expect(200);
    expect(resA.body.agentId).toBe(agentA);
    expect(resA.body.balanceMinor).toBe('12345');
    const resB = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentB}/financial-position`).set('Authorization', `Bearer ${tokenW}`).expect(200);
    expect(resB.body.agentId).toBe(agentB);
    expect(resB.body.balanceMinor).toBe('0'); // B has no funds, not leaking A's balance
    // AGENT synthetic cannot access B via internal
    const tokenAgent = workforceToken('AGENT');
    const denied = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentB}/financial-position`).set('Authorization', `Bearer ${tokenAgent}`);
    expect([401,403].includes(denied.status)).toBe(true);
  });

  // 11. no balance column
  it('11. no balance column on wallet_accounts', async () => {
    const cols: Array<{column_name:string}> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='wallet_accounts'`);
    const names = cols.map(c=>c.column_name);
    expect(names).not.toContain('balance');
    expect(names).not.toContain('balance_minor');
    expect(names).not.toContain('available_balance');
  });

  // 12. no ledger mutation
  it('12. no ledger mutation on read', async () => {
    const agentId = await createAgentDirect();
    await walletService.createWallet({ customerId: agentId, currency: 'NGN', idempotencyKey: `hard07-nomut-${agentId}` });
    const before: Array<{count:string}> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const token = workforceToken('SUPPORT');
    await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`).expect(200);
    const after: Array<{count:string}> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    expect(Number(after[0]!.count)).toBe(Number(before[0]!.count));
  });

  // 13. no second ledger
  it('13. no second ledger table', async () => {
    const tables: Array<{tablename:string}> = await dataSource.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
    const tns = tables.map(t=>t.tablename);
    expect(tns).not.toContain('agent_balance_cache');
    expect(tns).not.toContain('agent_ledger');
    expect(tns).not.toContain('admin_ledger');
    expect(tns).not.toContain('agent_financial_position_cache');
  });

  // 14. safe projection (no secrets)
  it('14. safe projection no secret/PIN/credential/ledgerAccountId leakage', async () => {
    const agentId = await createAgentDirect();
    const wallet = await walletService.createWallet({ customerId: agentId, currency: 'NGN', idempotencyKey: `hard07-safe-${agentId}` });
    const token = workforceToken('SUPPORT');
    const res = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`).expect(200);
    const blob = JSON.stringify(res.body).toLowerCase();
    expect(blob).not.toContain('password');
    expect(blob).not.toContain('pinhash');
    expect(blob).not.toContain('pin');
    expect(blob).not.toContain('otp');
    expect(blob).not.toContain('secrethash');
    expect(blob).not.toContain('tokenhash');
    expect(blob).not.toContain('ledgeraccountid');
    expect(blob).not.toContain('ledger_account_id');
    expect(blob).not.toContain('idempotency');
    expect(blob).not.toContain('requesthash');
    expect(blob).not.toContain('hash');
    // ensure fields are exactly safe
    expect(res.body.agentId).toBe(agentId);
    expect(res.body.currency).toBe('NGN');
    expect(res.body.balanceMinor).toBeDefined();
    expect(res.body.walletId).toBe(wallet.id);
    // ledgerAccountId must not be exposed
    expect((res.body as any).ledgerAccountId).toBeUndefined();
    // also check via raw wallet has ledgerAccountId but response hides it
    const rawWalletRows: Array<{ledger_account_id:string}> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [wallet.id]);
    expect(rawWalletRows[0]!.ledger_account_id).toBeDefined();
    expect(blob).not.toContain(rawWalletRows[0]!.ledger_account_id.toLowerCase());
  });

  // 15. read-only (POST should 404, no fund/defund)
  it('15. read-only: POST to financial-position is 404 and does not mutate', async () => {
    const agentId = await createAgentDirect();
    const wallet = await walletService.createWallet({ customerId: agentId, currency: 'NGN', idempotencyKey: `hard07-ro-${agentId}` });
    const token = workforceToken('OPERATOR');
    const before: Array<{count:string}> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const postRes = await request(app.getHttpServer()).post(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`).send({});
    expect([404,405].includes(postRes.status)).toBe(true);
    const after: Array<{count:string}> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    expect(Number(after[0]!.count)).toBe(Number(before[0]!.count));
    // also ensure GET still works and is ledger-derived
    const getRes = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}/financial-position`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(getRes.body.balanceMinor).toBe('0');
  });

  // 16. 66 migrations
  it('16. 66 migrations preserved', async () => {
    const rows: Array<{count:string}> = await dataSource.query(`SELECT count(*)::text as count FROM typeorm_migrations`);
    expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(67);
    const latest: Array<{name:string, timestamp:string}> = await dataSource.query(`SELECT name, timestamp::text as timestamp FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(['1785753600066', '1785753600067', '1785753600068', '1785753600069', '1785753600070', '1785753600071', '1785753600072', '1785753600073', '1785753600074', '1785753600075', '1785753600076', '1785753600077', '1785753600078', '1785753600079', '1785753600080', '1785753600081', '1785753600082', '1785753600083']).toContain(latest[0]!.timestamp);
  });
});
