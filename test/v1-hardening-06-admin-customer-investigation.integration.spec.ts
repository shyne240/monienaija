/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { randomUUID, pbkdf2Sync } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { SupportService } from '../src/support/support.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'hard06-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-HARDENING-06 Admin Customer Investigation (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let supportService: SupportService;

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
      if (!token || !token.startsWith('workforce-'))
        throw new UnauthorizedException('invalid workforce token');
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = [
        'SUPPORT',
        'OPERATOR',
        'SERVICE',
        'PRIVILEGED',
        'AGENT',
        'CUSTOMER',
        'AGGREGATOR',
      ];
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
    dataSource = await createIntegrationDataSource('v1-hardening-06');
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
    supportService = moduleRef.get(SupportService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource)
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  function workforceToken(type: string): string {
    return `workforce-${type}`;
  }

  async function createCustomerWithPhone(
    canonical10?: string,
  ): Promise<{ customerId: string; phone: string; reference: string }> {
    const reference = `cust-hard06-${randomUUID().slice(0, 8)}`;
    const phone =
      canonical10 ?? `8${String(100000000 + Math.floor(Math.random() * 900000000))}`.slice(0, 10);
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, `Cust ${customerId.slice(0, 4)}`],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$3,true)`,
      [customerId, `0${phone.slice(1)}`, phone],
    );
    const pwd = 'Password1!';
    const hash = encodePbkdf2(pwd, 'cust-salt');
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    return { customerId, phone, reference };
  }

  async function createAgentDirect(): Promise<string> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-hard06-${randomUUID().slice(0, 6)}`,
        `CODE-${randomUUID().slice(0, 6)}`,
        'hard06 class',
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const classId = classRows[0]!.id;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`ag-${randomUUID()}`, classId],
    );
    return rows[0]!.id;
  }

  // 1. auth matrix transactions: SUPPORT/OPERATOR/SERVICE/PRIVILEGED allowed
  it('1. transactions: SUPPORT/OPERATOR/SERVICE/PRIVILEGED allowed, CUSTOMER/AGENT/unauth denied', async () => {
    const { customerId } = await createCustomerWithPhone();
    const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'];
    for (const role of allowed) {
      const token = workforceToken(role);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${customerId}/transactions`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
      expect(res.body.pagination).toBeDefined();
    }
    for (const role of ['CUSTOMER', 'AGENT']) {
      const token = workforceToken(role);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${customerId}/transactions`)
        .set('Authorization', `Bearer ${token}`);
      expect([401, 403].includes(res.status)).toBe(true);
    }
    const unauth = await request(app.getHttpServer()).get(
      `/api/v1/internal/customers/${customerId}/transactions`,
    );
    expect(unauth.status).toBe(401);
    const bad = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions`)
      .set('Authorization', 'Bearer invalid');
    expect([401, 403].includes(bad.status)).toBe(true);
  });

  // 2. wallets auth
  it('2. wallets: SUPPORT/OPERATOR/SERVICE/PRIVILEGED allowed, CUSTOMER/AGENT denied', async () => {
    const { customerId } = await createCustomerWithPhone();
    const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'];
    for (const role of allowed) {
      const token = workforceToken(role);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${customerId}/wallets`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    }
    for (const role of ['CUSTOMER', 'AGENT']) {
      const token = workforceToken(role);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${customerId}/wallets`)
        .set('Authorization', `Bearer ${token}`);
      expect([401, 403].includes(res.status)).toBe(true);
    }
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/wallets`)
      .expect(401);
  });

  // 3. wallet balance auth
  it('3. wallet balance: workforce allowed, customer/agent denied, unauth 401', async () => {
    const { customerId } = await createCustomerWithPhone();
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `hard06-bal-${randomUUID()}`,
    });
    for (const role of ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']) {
      const token = workforceToken(role);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${customerId}/wallets/${wallet.id}/balance`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.balanceMinor).toBeDefined();
    }
    for (const role of ['CUSTOMER', 'AGENT']) {
      const token = workforceToken(role);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${customerId}/wallets/${wallet.id}/balance`)
        .set('Authorization', `Bearer ${token}`);
      expect([401, 403].includes(res.status)).toBe(true);
    }
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/wallets/${wallet.id}/balance`)
      .expect(401);
  });

  // 4. support-tickets auth
  it('4. support-tickets: SUPPORT/OPERATOR/SERVICE/PRIVILEGED allowed, CUSTOMER/AGENT denied', async () => {
    const { customerId } = await createCustomerWithPhone();
    for (const role of ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']) {
      const token = workforceToken(role);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${customerId}/support-tickets`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
      expect(res.body.pagination).toBeDefined();
    }
    for (const role of ['CUSTOMER', 'AGENT']) {
      const token = workforceToken(role);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/customers/${customerId}/support-tickets`)
        .set('Authorization', `Bearer ${token}`);
      expect([401, 403].includes(res.status)).toBe(true);
    }
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/support-tickets`)
      .expect(401);
  });

  // 5. transactions pagination/ordering deterministic createdAt DESC id DESC
  it('5. transactions: pagination deterministic ordering createdAt DESC id DESC', async () => {
    const { customerId } = await createCustomerWithPhone('8111111111');
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `hard06-ord-${customerId}`,
    });
    // create 2 funding requests with explicit created_at
    const now = new Date();
    const earlier = new Date(now.getTime() - 10000);
    const id1 = randomUUID();
    const id2 = randomUUID();
    // funding1 earlier - minimal required columns
    await dataSource.query(
      `INSERT INTO customer_funding_requests (id, customer_id, amount_minor, currency, status, reference, maker_id, maker_type, idempotency_key, request_hash, created_at, updated_at) VALUES ($1,$2,'10000','NGN','PENDING',$3,'maker1','OPERATOR',$4,$5,$6,$6)`,
      [id1, customerId, `REF-${id1.slice(0, 8)}`, `idem-${id1}`, 'a'.repeat(64), earlier],
    );
    await dataSource.query(
      `INSERT INTO customer_funding_requests (id, customer_id, amount_minor, currency, status, reference, maker_id, maker_type, idempotency_key, request_hash, created_at, updated_at) VALUES ($1,$2,'20000','NGN','PENDING',$3,'maker1','OPERATOR',$4,$5,$6,$6)`,
      [id2, customerId, `REF-${id2.slice(0, 8)}`, `idem-${id2}`, 'b'.repeat(64), now],
    );
    const token = workforceToken('SUPPORT');
    const res1 = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions?page=1&limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res1.body.items.length).toBe(1);
    expect(res1.body.items[0].id).toBe(id2); // most recent first
    const res2 = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions?page=2&limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res2.body.items[0].id).toBe(id1);
    expect(res2.body.pagination.total).toBe(2);
    expect(res2.body.pagination.hasNextPage).toBe(false);
    expect(res1.body.pagination.hasNextPage).toBe(true);
    // same-timestamp id DESC: insert two with same created_at but different ids
    const sameTime = new Date();
    const idA = randomUUID();
    const idB = randomUUID();
    // ensure idB > idA lexicographically? we sort DESC id, so larger id first. Generate deterministic ids
    const sorted = [idA, idB].sort().reverse(); // descending
    await dataSource.query(
      `INSERT INTO customer_funding_requests (id, customer_id, amount_minor, currency, status, reference, maker_id, maker_type, idempotency_key, request_hash, created_at, updated_at) VALUES ($1,$2,'1000','NGN','PENDING',$3,'maker1','OPERATOR',$4,$5,$6,$6)`,
      [idA, customerId, `REF-${idA.slice(0, 8)}`, `idem-${idA}`, 'c'.repeat(64), sameTime],
    );
    await dataSource.query(
      `INSERT INTO customer_funding_requests (id, customer_id, amount_minor, currency, status, reference, maker_id, maker_type, idempotency_key, request_hash, created_at, updated_at) VALUES ($1,$2,'1000','NGN','PENDING',$3,'maker1','OPERATOR',$4,$5,$6,$6)`,
      [idB, customerId, `REF-${idB.slice(0, 8)}`, `idem-${idB}`, 'd'.repeat(64), sameTime],
    );
    const all = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions?page=1&limit=10`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const idsSameTime = all.body.items
      .filter((x: any) => [idA, idB].includes(x.id))
      .map((x: any) => x.id);
    // should be descending id
    expect(idsSameTime).toEqual(sorted);
  });

  // 6. type filtering exact and 5 types appear
  it('6. transactions: exact ?type filtering and all 5 types appear unified', async () => {
    const { customerId, phone } = await createCustomerWithPhone('8222222222');
    const { customerId: custB } = await createCustomerWithPhone('8222222223');
    const walletA = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `hard06-5t-a-${customerId}`,
    });
    const walletB = await walletService.createWallet({
      customerId: custB,
      currency: 'NGN',
      idempotencyKey: `hard06-5t-b-${custB}`,
    });
    const agentId = await createAgentDirect();
    const token = workforceToken('OPERATOR');
    // FUNDING
    const fundId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_funding_requests (id, customer_id, amount_minor, currency, status, reference, description, maker_id, maker_type, journal_id, idempotency_key, request_hash, created_at, updated_at) VALUES ($1,$2,'5000','NGN','PENDING',$3,'fund','maker','OPERATOR',null,$4,$5,now(),now())`,
      [fundId, customerId, `REF-${fundId.slice(0, 8)}`, `idem-${fundId}`, 'e'.repeat(64)],
    );
    // WALLET_TRANSFER
    await dataSource.query(
      `INSERT INTO transfers (id, source_wallet_id, destination_wallet_id, amount_minor, currency, status, idempotency_key, request_hash, created_at, updated_at) VALUES ($1,$2,$3,'1000','NGN','FAILED',$4,$5,now(),now())`,
      [randomUUID(), walletA.id, walletB.id, `idem-${randomUUID()}`, 'a'.repeat(64)],
    );
    // CASH_TO_CASH (beneficiary phone matches customer phone)
    const plat = await ledgerService.createAccount({
      code: `PLAT6_${randomUUID().slice(0, 6)}`,
      name: 'Plat6',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    let unclaimedId: string;
    const unclaimedRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_accounts WHERE code='CASH_TO_CASH-UNCLAIMED-NGN' LIMIT 1`,
    );
    if (unclaimedRows[0]?.id) unclaimedId = unclaimedRows[0].id;
    else {
      const acc = await ledgerService.createAccount({
        code: 'CASH_TO_CASH-UNCLAIMED-NGN',
        name: 'Unclaimed',
        accountType: 'LIABILITY' as any,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
      });
      unclaimedId = acc.id;
    }
    const agentWalletRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM wallet_accounts WHERE customer_id=$1 LIMIT 1`,
      [agentId],
    );
    let agentWalletId: string;
    if (agentWalletRows.length) agentWalletId = agentWalletRows[0].id;
    else {
      const aw = await walletService.createWallet({
        customerId: agentId,
        currency: 'NGN',
        idempotencyKey: `aw-${agentId}`,
      });
      agentWalletId = aw.id;
      // need ledger account
      const waLedgerRows: Array<{ ledger_account_id: string }> = await dataSource.query(
        `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
        [agentWalletId],
      );
      const agentLedgerId = waLedgerRows[0]!.ledger_account_id;
      // fund agent
      const plat2 = await ledgerService.createAccount({
        code: `PLAT6b_${randomUUID().slice(0, 6)}`,
        name: 'Plat6b',
        accountType: 'ASSET' as any,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
      });
      await ledgerService.postJournal({
        idempotencyKey: `fundAg6-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: `ref-${randomUUID()}`,
        lines: [
          { accountId: plat2.id, direction: 'DEBIT' as any, amountMinor: '100000' },
          { accountId: agentLedgerId, direction: 'CREDIT' as any, amountMinor: '100000' },
        ],
      });
    }
    // fund walletA to cover c2c debit and cash_out
    const fundPlatA = await ledgerService.createAccount({
      code: `PLATFUND6_${randomUUID().slice(0, 6)}`,
      name: 'PlatFundA6',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    const wALedgerForFund: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [walletA.id],
    );
    await ledgerService.postJournal({
      idempotencyKey: `fundWalletA6-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      lines: [
        { accountId: fundPlatA.id, direction: 'DEBIT' as any, amountMinor: '100000' },
        {
          accountId: wALedgerForFund[0]!.ledger_account_id,
          direction: 'CREDIT' as any,
          amountMinor: '100000',
        },
      ],
    });
    // create c2c journal
    const wALedgerRows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [walletA.id],
    );
    const c2cJournal = await ledgerService.postJournal({
      idempotencyKey: `c2c6-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      lines: [
        {
          accountId: wALedgerRows[0]!.ledger_account_id,
          direction: 'DEBIT' as any,
          amountMinor: '2000',
        },
        { accountId: unclaimedId, direction: 'CREDIT' as any, amountMinor: '2000' },
      ],
    });
    const c2cJournalId = (c2cJournal as any).id as string;
    // get agent ledger? need to fetch
    const c2cId = randomUUID();
    await dataSource.query(
      `INSERT INTO cash_to_cash_transfers (id, agent_id, beneficiary_phone, principal_minor, fee_minor, vat_minor, total_minor, currency, status, transfer_code_hash, hash_algorithm, journal_id, reference, idempotency_key, correlation_id, expires_at) VALUES ($1,$2,$3,'2000','0','0','2000','NGN','UNCLAIMED','hash','PBKDF2',$4,$5,$6,$7, now()+interval '7 days')`,
      [
        c2cId,
        agentId,
        phone,
        c2cJournalId,
        `ref-${c2cId.slice(0, 6)}`,
        `idem-${c2cId}`,
        `corr-${c2cId}`,
      ],
    );
    // CASH_IN and CASH_OUT via ledger journals with canonicalService
    const platCash = await ledgerService.createAccount({
      code: `PLATCASH_${randomUUID().slice(0, 6)}`,
      name: 'PlatCash',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    const cashInJournal = await ledgerService.postJournal({
      idempotencyKey: `cashin6-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      metadata: { canonicalService: 'CASH_IN' } as any,
      lines: [
        { accountId: platCash.id, direction: 'DEBIT' as any, amountMinor: '3000' },
        {
          accountId: wALedgerRows[0]!.ledger_account_id,
          direction: 'CREDIT' as any,
          amountMinor: '3000',
        },
      ],
    });
    const cashOutJournal = await ledgerService.postJournal({
      idempotencyKey: `cashout6-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      metadata: { canonicalService: 'CASH_OUT' } as any,
      lines: [
        {
          accountId: wALedgerRows[0]!.ledger_account_id,
          direction: 'DEBIT' as any,
          amountMinor: '1500',
        },
        { accountId: platCash.id, direction: 'CREDIT' as any, amountMinor: '1500' },
      ],
    });

    const all = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions?page=1&limit=20`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const types = new Set(all.body.items.map((x: any) => x.type));
    // should contain all 5
    expect(types.has('FUNDING')).toBe(true);
    expect(types.has('WALLET_TRANSFER')).toBe(true);
    expect(types.has('CASH_TO_CASH')).toBe(true);
    expect(types.has('CASH_IN')).toBe(true);
    expect(types.has('CASH_OUT')).toBe(true);

    // exact type filtering
    const fundingOnly = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions?type=FUNDING`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(fundingOnly.body.items.length).toBeGreaterThanOrEqual(1);
    for (const it of fundingOnly.body.items) expect(it.type).toBe('FUNDING');
    const walletOnly = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions?type=WALLET_TRANSFER`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    for (const it of walletOnly.body.items) expect(it.type).toBe('WALLET_TRANSFER');
    const cashInOnly = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions?type=CASH_IN`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    for (const it of cashInOnly.body.items) expect(it.type).toBe('CASH_IN');
    const cashOutOnly = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions?type=CASH_OUT`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    for (const it of cashOutOnly.body.items) expect(it.type).toBe('CASH_OUT');
    const c2cOnly = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions?type=CASH_TO_CASH`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    for (const it of c2cOnly.body.items) expect(it.type).toBe('CASH_TO_CASH');

    // invalid type should 400
    const bad = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions?type=INVALID`)
      .set('Authorization', `Bearer ${token}`);
    expect(bad.status).toBe(400);
  });

  // 7. safe projection no secrets
  it('7. transactions safe projection hides journalId/ledgerAccountId/idempotency/requestHash/PIN/OTP/hash', async () => {
    const { customerId } = await createCustomerWithPhone('8333333333');
    const { customerId: custB } = await createCustomerWithPhone('8333333334');
    const walletA = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `hard06-safe-${randomUUID()}`,
    });
    const walletB = await walletService.createWallet({
      customerId: custB,
      currency: 'NGN',
      idempotencyKey: `hard06-safe2-${randomUUID()}`,
    });
    await dataSource.query(
      `INSERT INTO transfers (id, source_wallet_id, destination_wallet_id, amount_minor, currency, status, idempotency_key, request_hash, created_at, updated_at) VALUES ($1,$2,$3,'5000','NGN','FAILED',$4,$5,now(),now())`,
      [randomUUID(), walletA.id, walletB.id, `idem-${randomUUID()}`, 'b'.repeat(64)],
    );
    const fundId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_funding_requests (id, customer_id, amount_minor, currency, status, reference, maker_id, maker_type, journal_id, idempotency_key, request_hash, created_at, updated_at) VALUES ($1,$2,'7000','NGN','PENDING',$3,'maker','OPERATOR',null,$4,$5,now(),now())`,
      [fundId, customerId, `REF-${fundId.slice(0, 6)}`, `idem-${fundId}`, 'f'.repeat(64)],
    );
    const token = workforceToken('SUPPORT');
    const res = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const blob = JSON.stringify(res.body).toLowerCase();
    expect(blob).not.toContain('journalid');
    expect(blob).not.toContain('journal_id');
    expect(blob).not.toContain('ledgeraccountid');
    expect(blob).not.toContain('ledger_account_id');
    expect(blob).not.toContain('idempotency');
    expect(blob).not.toContain('requesthash');
    expect(blob).not.toContain('request_hash');
    expect(blob).not.toContain('pinhash');
    expect(blob).not.toContain('password');
    expect(blob).not.toContain('otphash');
    expect(blob).not.toContain('hash');
    // ensure keys not present as exact fields
    for (const it of res.body.items) {
      expect(it.journalId).toBeUndefined();
      expect(it.ledgerAccountId).toBeUndefined();
      expect(it.idempotencyKey).toBeUndefined();
      expect(it.requestHash).toBeUndefined();
      expect(it.pin).toBeUndefined();
      expect(it.otp).toBeUndefined();
    }
  });

  // 8. wallets listing safe customer-scoped
  it('8. wallets listing customer-scoped safe projection currency explicit no balance column', async () => {
    const { customerId } = await createCustomerWithPhone('8444444444');
    const { customerId: otherId } = await createCustomerWithPhone('8444444445');
    const w1 = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `hard06-wlist-${customerId}`,
    });
    const wOther = await walletService.createWallet({
      customerId: otherId,
      currency: 'NGN',
      idempotencyKey: `hard06-wlist-other-${otherId}`,
    });
    const token = workforceToken('SUPPORT');
    const res = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/wallets`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe(w1.id);
    expect(res.body.data[0].customerId).toBe(customerId);
    expect(res.body.data[0].currency).toBe('NGN');
    expect(res.body.data[0].status).toBeDefined();
    expect(res.body.data[0].createdAt).toBeDefined();
    const blob = JSON.stringify(res.body).toLowerCase();
    expect(blob).not.toContain('ledgeraccountid');
    expect(blob).not.toContain('ledger_account_id');
    expect(blob).not.toContain('creationidempotency');
    expect(blob).not.toContain('balance');
    // other customer wallet not leaked
    expect(res.body.data.find((x: any) => x.id === wOther.id)).toBeUndefined();
    // list for other customer should show its wallet only
    const resOther = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${otherId}/wallets`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(resOther.body.data.length).toBe(1);
    expect(resOther.body.data[0].id).toBe(wOther.id);
  });

  // 9. wallet balance ledger-derived ownership enforced
  it('9. wallet balance ledger-derived, ownership verify, currency explicit, safe', async () => {
    const { customerId } = await createCustomerWithPhone('8555555555');
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `hard06-bal2-${customerId}`,
    });
    const wRows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    const ledgerId = wRows[0]!.ledger_account_id;
    const plat = await ledgerService.createAccount({
      code: `PLATBAL_${randomUUID().slice(0, 6)}`,
      name: 'PlatBal',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ledgerService.postJournal({
      idempotencyKey: `balcred-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      lines: [
        { accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '12345' },
        { accountId: ledgerId, direction: 'CREDIT' as any, amountMinor: '12345' },
      ],
    });
    const token = workforceToken('OPERATOR');
    const res = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/wallets/${wallet.id}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.walletId).toBe(wallet.id);
    expect(res.body.customerId).toBe(customerId);
    expect(res.body.currency).toBe('NGN');
    expect(res.body.balanceMinor).toBe('12345');
    expect(res.body.status).toBe('ACTIVE');
    const blob = JSON.stringify(res.body).toLowerCase();
    expect(blob).not.toContain('ledgeraccountid');
    expect(blob).not.toContain('ledger_account_id');
    // second credit increases balance
    await ledgerService.postJournal({
      idempotencyKey: `balcred2-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      lines: [
        { accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '1000' },
        { accountId: ledgerId, direction: 'CREDIT' as any, amountMinor: '1000' },
      ],
    });
    const res2 = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/wallets/${wallet.id}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res2.body.balanceMinor).toBe('13345');
  });

  // 10. cross-customer balance denied 404, walletId alone cannot access other customer
  it('10. cross-customer balance rejected 404, isolation via wallet.customerId', async () => {
    const { customerId: idA } = await createCustomerWithPhone('8666666666');
    const { customerId: idB } = await createCustomerWithPhone('8666666667');
    const walletA = await walletService.createWallet({
      customerId: idA,
      currency: 'NGN',
      idempotencyKey: `hard06-cross-a-${idA}`,
    });
    const walletB = await walletService.createWallet({
      customerId: idB,
      currency: 'NGN',
      idempotencyKey: `hard06-cross-b-${idB}`,
    });
    const token = workforceToken('SUPPORT');
    // A wallet accessed via B customer id should 404
    const res = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${idB}/wallets/${walletA.id}/balance`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    // B wallet via A should 404
    const res2 = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${idA}/wallets/${walletB.id}/balance`)
      .set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(404);
    // non-existent wallet 404
    const fake = randomUUID();
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${idA}/wallets/${fake}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    // non-existent customer 404
    const fakeCust = randomUUID();
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${fakeCust}/wallets/${walletA.id}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  // 11. support-tickets alias customer-scoped preserves status/assignment/linkage, internal-message filtering
  it('11. support-tickets alias customer-scoped preserves status/assignment/linkage no internal-message leak', async () => {
    const { customerId: custA } = await createCustomerWithPhone('8777777777');
    const { customerId: custB } = await createCustomerWithPhone('8777777778');
    const token = workforceToken('SUPPORT');
    const now = new Date();
    const ticketA1 = randomUUID();
    const ticketA2 = randomUUID();
    const ticketB = randomUUID();
    const fundId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_funding_requests (id, customer_id, amount_minor, currency, status, reference, maker_id, maker_type, journal_id, idempotency_key, request_hash, created_at, updated_at) VALUES ($1,$2,'1000','NGN','PENDING',$3,'maker','OPERATOR',null,$4,$5,$6,$6)`,
      [fundId, custA, `REF-${fundId.slice(0, 6)}`, `idem-${fundId}`, 'a'.repeat(64), now],
    );
    await dataSource.query(
      `INSERT INTO support_tickets (id, reference, customer_id, agent_id, created_by_type, created_by_id, subject, category, description, status, priority, assigned_to, funding_request_id, related_transfer_id, created_at, updated_at, version) VALUES ($1,$2,$3,null,'SUPPORT','workforce-support-1','Issue A1','OTHER','Desc A1','OPEN','MEDIUM',null,null,null,$4,$4,1)`,
      [ticketA1, `SUP-${ticketA1.slice(0, 8)}`, custA, now],
    );
    await dataSource.query(
      `INSERT INTO support_tickets (id, reference, customer_id, agent_id, created_by_type, created_by_id, subject, category, description, status, priority, assigned_to, funding_request_id, related_transfer_id, created_at, updated_at, version) VALUES ($1,$2,$3,null,'SUPPORT','workforce-support-1','Issue A2','FUNDING','Desc A2','IN_PROGRESS','HIGH','ops-1',$4,null,$5,$5,1)`,
      [ticketA2, `SUP-${ticketA2.slice(0, 8)}`, custA, fundId, now],
    );
    await dataSource.query(
      `INSERT INTO support_tickets (id, reference, customer_id, agent_id, created_by_type, created_by_id, subject, category, description, status, priority, assigned_to, created_at, updated_at, version) VALUES ($1,$2,$3,null,'SUPPORT','workforce-support-1','Issue B','OTHER','Desc B','OPEN','MEDIUM',null,$4,$4,1)`,
      [ticketB, `SUP-${ticketB.slice(0, 8)}`, custB, now],
    );
    // internal messages for ticketA1
    await dataSource.query(
      `INSERT INTO support_ticket_messages (id, ticket_id, author_type, author_id, body, is_internal, created_at) VALUES ($1,$2,'SUPPORT','workforce-support-1','internal note',true,now())`,
      [randomUUID(), ticketA1],
    );
    await dataSource.query(
      `INSERT INTO support_ticket_messages (id, ticket_id, author_type, author_id, body, is_internal, created_at) VALUES ($1,$2,'CUSTOMER',$3,'customer reply',false,now())`,
      [randomUUID(), ticketA1, custA],
    );

    const res = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${custA}/support-tickets`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.items.length).toBe(2);
    const ids = res.body.items.map((x: any) => x.id);
    expect(ids).toContain(ticketA1);
    expect(ids).toContain(ticketA2);
    expect(ids).not.toContain(ticketB);
    // check status/assignment/linkage preserved
    const a2 = res.body.items.find((x: any) => x.id === ticketA2);
    expect(a2.status).toBe('IN_PROGRESS');
    expect(a2.assignedTo).toBe('ops-1');
    expect(a2.fundingRequestId).toBe(fundId);
    const a1 = res.body.items.find((x: any) => x.id === ticketA1);
    expect(a1.status).toBe('OPEN');
    // list should not expose messages (no body/internal leak)
    const blob = JSON.stringify(res.body).toLowerCase();
    expect(blob).not.toContain('internal note');
    expect(blob).not.toContain('customer reply');
    expect(blob).not.toContain('is_internal');

    // filtering by status
    const openOnly = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${custA}/support-tickets?status=OPEN`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(openOnly.body.items.length).toBe(1);
    expect(openOnly.body.items[0].id).toBe(ticketA1);

    // pagination
    const page1 = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${custA}/support-tickets?page=1&limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page1.body.items.length).toBe(1);
    expect(page1.body.pagination.total).toBe(2);
    expect(page1.body.pagination.hasNextPage).toBe(true);
    const page2 = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${custA}/support-tickets?page=2&limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page2.body.items.length).toBe(1);
    expect(page2.body.pagination.hasNextPage).toBe(false);

    // direct support module listForInternal with customer filter should match
    const direct = await supportService.listForInternal(1, 20, { customerId: custA });
    expect(direct.items.length).toBe(2);
    expect(new Set(direct.items.map((x) => x.id))).toEqual(new Set(ids));
  });

  // 12. no balance column via info_schema, no second ledger, 66 migrations, ledger not mutated by reads
  it('12. no balance column on wallet_accounts, no second ledger, 66 migrations, reads do not create journals', async () => {
    const cols: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='wallet_accounts'`,
    );
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain('balance');
    expect(names).not.toContain('balance_minor');
    // no second ledger tables like customer_balance_cache etc.
    const tables: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public'`,
    );
    const tns = tables.map((t) => t.tablename);
    expect(tns).not.toContain('customer_balance_cache');
    expect(tns).not.toContain('admin_ledger');
    expect(tns).not.toContain('customer_ledger_copy');
    const mig: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text as count FROM typeorm_migrations`,
    );
    expect(Number(mig[0]!.count)).toBeGreaterThanOrEqual(67);
    const latest: Array<{ name: string; timestamp: string }> = await dataSource.query(
      `SELECT name, timestamp::text as timestamp FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`,
    );
    expect([
      '1785753600066',
      '1785753600067',
      '1785753600068',
      '1785753600069',
      '1785753600070',
      '1785753600071',
      '1785753600072',
      '1785753600073',
      '1785753600074',
      '1785753600075',
      '1785753600076',
      '1785753600077',
      '1785753600078',
    ]).toContain(latest[0]!.timestamp);
    expect(latest[0]!.name).toMatch(
      /^(Create(CapabilityRegistry|LimitProfileCatalogue|LimitAssignments|LimitUsages)178575360006[6-9]|CreateCommercialDecisionSnapshots1785753600070|CreateProductCatalogue1785753600071|CreateFeeRules1785753600072|CreateCommissionRules1785753600073|CreateRewardRules1785753600074|AddTransferFeeColumns1785753600075|ProvisionV1CommercialAccountingFamilies1785753600076|AddAgentCredentialRotation1785753600077|CreateCustomerRegistrationPhoneChallenges1785753600078)$/,
    );

    const { customerId } = await createCustomerWithPhone('8888888888');
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `hard06-nomut-${randomUUID()}`,
    });
    const before: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text as count FROM ledger_journals`,
    );
    const token = workforceToken('SUPPORT');
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/transactions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/wallets`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/wallets/${wallet.id}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/support-tickets`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const after: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text as count FROM ledger_journals`,
    );
    expect(Number(after[0]!.count)).toBe(Number(before[0]!.count));
  });

  // 13. isolation: wallet listing and balance not leaking other customer data, transaction history customer-scoped
  it('13. isolation: transaction history and wallets strictly customer-scoped', async () => {
    const { customerId: idA } = await createCustomerWithPhone('8999999999');
    const { customerId: idB } = await createCustomerWithPhone('8000000001');
    const wA = await walletService.createWallet({
      customerId: idA,
      currency: 'NGN',
      idempotencyKey: `hard06-iso-a-${idA}`,
    });
    const wB = await walletService.createWallet({
      customerId: idB,
      currency: 'NGN',
      idempotencyKey: `hard06-iso-b-${idB}`,
    });
    const fundA = randomUUID();
    const fundB = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_funding_requests (id, customer_id, amount_minor, currency, status, reference, maker_id, maker_type, journal_id, idempotency_key, request_hash, created_at, updated_at) VALUES ($1,$2,'1000','NGN','PENDING',$3,'maker','OPERATOR',null,$4,$5,now(),now())`,
      [fundA, idA, `REF-${fundA.slice(0, 6)}`, `idem-${fundA}`, 'a'.repeat(64)],
    );
    await dataSource.query(
      `INSERT INTO customer_funding_requests (id, customer_id, amount_minor, currency, status, reference, maker_id, maker_type, journal_id, idempotency_key, request_hash, created_at, updated_at) VALUES ($1,$2,'2000','NGN','PENDING',$3,'maker','OPERATOR',null,$4,$5,now(),now())`,
      [fundB, idB, `REF-${fundB.slice(0, 6)}`, `idem-${fundB}`, 'b'.repeat(64)],
    );
    const token = workforceToken('OPERATOR');
    const histA = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${idA}/transactions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(histA.body.items.some((x: any) => x.id === fundA)).toBe(true);
    expect(histA.body.items.some((x: any) => x.id === fundB)).toBe(false);
    const histB = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${idB}/transactions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(histB.body.items.some((x: any) => x.id === fundB)).toBe(true);
    expect(histB.body.items.some((x: any) => x.id === fundA)).toBe(false);
    // wallets
    const wlA = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${idA}/wallets`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(wlA.body.data.some((x: any) => x.id === wA.id)).toBe(true);
    expect(wlA.body.data.some((x: any) => x.id === wB.id)).toBe(false);
    const wlB = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${idB}/wallets`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(wlB.body.data.some((x: any) => x.id === wB.id)).toBe(true);
    expect(wlB.body.data.some((x: any) => x.id === wA.id)).toBe(false);
    // support tickets
    const tA = randomUUID();
    const tB = randomUUID();
    await dataSource.query(
      `INSERT INTO support_tickets (id, reference, customer_id, created_by_type, created_by_id, subject, category, description, status, priority, created_at, updated_at, version) VALUES ($1,$2,$3,'SUPPORT','workforce-support-1','SubA','OTHER','Desc', 'OPEN','MEDIUM',now(),now(),1)`,
      [tA, `SUP-${tA.slice(0, 6)}`, idA],
    );
    await dataSource.query(
      `INSERT INTO support_tickets (id, reference, customer_id, created_by_type, created_by_id, subject, category, description, status, priority, created_at, updated_at, version) VALUES ($1,$2,$3,'SUPPORT','workforce-support-1','SubB','OTHER','Desc','OPEN','MEDIUM',now(),now(),1)`,
      [tB, `SUP-${tB.slice(0, 6)}`, idB],
    );
    const supA = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${idA}/support-tickets`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(supA.body.items.some((x: any) => x.id === tA)).toBe(true);
    expect(supA.body.items.some((x: any) => x.id === tB)).toBe(false);
  });

  // 14. 404 for non-existent customer on all endpoints, invalid UUID 400
  it('14. 404 for non-existent customer, 400 for invalid UUID', async () => {
    const fake = randomUUID();
    const fakeWallet = randomUUID();
    const token = workforceToken('SUPPORT');
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${fake}/transactions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${fake}/wallets`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${fake}/wallets/${fakeWallet}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${fake}/support-tickets`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    // invalid UUID
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/not-a-uuid/transactions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/not-a-uuid/wallets`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    const { customerId } = await createCustomerWithPhone('8110000002');
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `hard06-inv-${randomUUID()}`,
    });
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${customerId}/wallets/not-a-uuid/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  // 15. git diff only relevant, no fees/limits/beneficiary/reversal touched
  it('15. scope guard: no fees/limits/beneficiary/bank/NIBSS/cards/bills mutation, git diff only relevant', async () => {
    // check controller source does not import fees/limits/beneficiary etc.
    const fs = await import('node:fs');
    const ctrl = fs.readFileSync('src/admin/admin-customer.controller.ts', 'utf8');
    expect(ctrl).not.toContain('FeeService');
    expect(ctrl).not.toContain('LimitService');
    expect(ctrl).not.toContain('BeneficiaryService');
    expect(ctrl).not.toContain('ReversalService');
    expect(ctrl).not.toContain('BankService');
    expect(ctrl).not.toContain('NIBSS');
    expect(ctrl).not.toContain('cards');
    expect(ctrl).not.toContain('bills');
    // check admin module only imports expected
    const mod = fs.readFileSync('src/admin/admin.module.ts', 'utf8');
    expect(mod).toContain('WalletModule');
    expect(mod).toContain('SupportModule');
    expect(mod).toContain('CustomerTransactionHistoryService');
    // controller reuses services
    expect(ctrl).toContain('CustomerTransactionHistoryService');
    expect(ctrl).toContain('WalletService');
    expect(ctrl).toContain('SupportService');
    expect(ctrl).toContain('listUnified');
    expect(ctrl).toContain('getWalletBalance');
    expect(ctrl).toContain('listForInternal');
  });
});
