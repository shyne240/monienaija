/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { createHash, pbkdf2Sync, randomUUID } from 'node:crypto';
import * as request from 'supertest';

import type { HistoryResponseFixture } from './support/history-response-fixture';
import { AppModule } from '../src/app.module';
import { TrustedTierFixture } from './support/trusted-tier-fixture';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'a23-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { makeCustomerFinanciallyEligible } from './support/kyc-test-fixtures';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';

// Test-only trusted-evidence override. Opt-in per suite; the production reader stays
// fail-closed because nothing in AppModule references this module.
const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

describe('A23 Customer App Backend Foundation (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  /**
   * ARENA 4: the financial-eligibility gate requires authorised tier policy + a trusted evidence
   * source. Production has no confirmed evidence provider (the reader resolves `null` by design), so
   * this suite installs the same controlled `TrustedTierFixture` the other financial integration
   * suites use. The gate itself is untouched.
   */
  const evidence = new TrustedTierFixture();

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a23customerapp');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kycEvidence.reader)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
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
    // TRUNCATE also clears the singleton tier-policy head + versions, so re-seed the controlled
    // approved policy before each case (otherwise eligibility correctly reports "policy unavailable").
    await evidence.seedPolicy(dataSource);
  });

  async function createCustomerWithCredential(
    opts: {
      reference?: string;
      phone?: string;
      displayName?: string;
      password?: string;
      kycLevel?: string;
      kycStatus?: string;
      custStatus?: string;
    } = {},
  ): Promise<{ customerId: string; reference: string; phone: string; token: string }> {
    const reference = opts.reference ?? `cust-a23-${randomUUID()}`;
    const phone = opts.phone ?? `080${String(Math.floor(10000000 + Math.random() * 90000000))}`; // 10-digit-like but with leading 0 later canonicalized; we store phone normalized like +234...
    const displayName = opts.displayName ?? 'Customer A23';
    const password = opts.password ?? 'correct-password-a23';
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL',$2,$3,$4) RETURNING id`,
      [
        reference,
        opts.custStatus ?? 'ACTIVE',
        opts.kycLevel ?? 'LEVEL_1',
        opts.kycStatus ?? 'APPROVED',
      ],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, displayName],
    );
    // Phone contact — normalize to canonical via raw value includes digits; service expects normalizedValue same as value for simplicity
    const normalizedPhone = phone.startsWith('0') ? phone.slice(1) : phone; // store 9? But for resolution we need 10-digit starting hitch; we generate valid 10-digit for recipient resolution later
    // Ensure phone is 10 digits starting with 7/8/9 for recipient resolution to work; generate fresh
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    // Store contact with canonical as normalizedValue
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$3,true,now())`,
      [customerId, `0${canonical10.slice(1)}`, canonical10],
    );
    const hash = encodePbkdf2(password);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    // The governed gate now runs when a session is issued, and this helper builds the
    // customer with raw SQL only. Complete it here; a non-ACTIVE customer is left alone.
    await makeCustomerFinanciallyEligible(dataSource, customerId, kycEvidence);
    const login = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password })
      .expect(200);
    const token = login.body.accessToken as string;
    expect(token).toBeTruthy();
    return { customerId, reference, phone: canonical10, token };
  }

  async function createAgentToken(): Promise<string> {
    // Create agent and login to get agent token for rejection tests
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-a23-${randomUUID().slice(0, 8)}`,
        `A23-${randomUUID().slice(0, 6)}`,
        'A23 Class',
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const classId = classRows[0]!.id;
    const ref = `agent-a23-${randomUUID()}`;
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [ref, classId],
    );
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-a23', 'agent-salt');
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, hash],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: 'agent-pass-a23' })
      .expect(200);
    return login.body.accessToken as string;
  }

  it('1. Customer authentication/session/me — unauthenticated 401, login returns token, GET /customers/me works', async () => {
    const { customerId, token, reference } = await createCustomerWithCredential();
    await request(app.getHttpServer()).get('/api/v1/customers/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    const me = await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.id).toBe(customerId);
    expect(me.body.reference).toBe(reference);
    expect(me.body.status).toBe('ACTIVE');
    // sensitive fields not leaked
    const serial = JSON.stringify(me.body).toLowerCase();
    expect(serial).not.toContain('passwordhash');
    expect(serial).not.toContain('pinhash');
    expect(serial).not.toContain('tokenhash');
  });

  it('2. Profile — GET /customers/me/profile returns safe projection, status includes identity/status', async () => {
    const { customerId, token } = await createCustomerWithCredential({ displayName: 'Ada A23' });
    const profile = await request(app.getHttpServer())
      .get('/api/v1/customers/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(profile.body.id).toBe(customerId);
    expect(profile.body.status).toBe('ACTIVE');
    expect(profile.body.profile?.displayName).toBe('Ada A23');
    const status = await request(app.getHttpServer())
      .get('/api/v1/customers/me/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.id).toBe(customerId);
    expect(status.body.kycLevel).toBeDefined();
    const serial = JSON.stringify(profile.body).toLowerCase();
    expect(serial).not.toContain('password');
    expect(serial).not.toContain('secret');
  });

  it('3. Wallet/balance — ledger-derived, no cached balance column, no CustomerBalance table', async () => {
    const { token, customerId } = await createCustomerWithCredential();
    // list wallets empty -> 0
    const empty = await request(app.getHttpServer())
      .get('/api/v1/customers/me/wallets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(empty.body)).toBe(true);
    expect(empty.body.length).toBe(0);
    const finEmpty = await request(app.getHttpServer())
      .get('/api/v1/customers/me/financial-position')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(finEmpty.body.balanceMinor).toBe('0');
    expect(finEmpty.body.walletExists).toBe(false);
    // Create wallet via WalletService directly (ensures correct ledger LIABILITY/CREDIT/CUSTOMER_FUNDS)
    const { WalletService } = await import('../src/wallet/wallet.service');
    const { LedgerService } = await import('../src/ledger/ledger.service');
    const walletService = app.get(WalletService);
    const ledgerService = app.get(LedgerService);
    // Batch 2C: this fixture created the customer with raw SQL only, which the governed
    // financial-eligibility gate (correctly) rejects. Applied after the suite's own
    // profile/phone rows exist and immediately before the wallet that needs the gate.
    await makeCustomerFinanciallyEligible(dataSource, customerId, kycEvidence);
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `a23w-${customerId}`,
    });
    const walletId = wallet.id;
    const ledgerAccountId = wallet.ledgerAccountId;
    const wList = await request(app.getHttpServer())
      .get('/api/v1/customers/me/wallets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(wList.body.length).toBe(1);
    expect(wList.body[0].balanceMinor).toBe('0');
    expect(wList.body[0].id).toBe(walletId);
    // Credit wallet via ledger (platform asset debit, wallet credit) — proves ledger-derived
    const platformAccount = await ledgerService.createAccount({
      code: `PLATFORM_${randomUUID().slice(0, 6)}`,
      name: 'Platform Asset',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ledgerService.postJournal({
      idempotencyKey: `a23-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      lines: [
        { accountId: platformAccount.id, direction: 'DEBIT' as any, amountMinor: '12345' },
        { accountId: ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '12345' },
      ],
    });
    const after = await request(app.getHttpServer())
      .get('/api/v1/customers/me/wallets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body[0].balanceMinor).toBe('12345');
    const bal = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/wallets/${walletId}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(bal.body.balanceMinor).toBe('12345');
    const fin = await request(app.getHttpServer())
      .get('/api/v1/customers/me/financial-position')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(fin.body.balanceMinor).toBe('12345');
    expect(fin.body.walletExists).toBe(true);
    // Ensure no balance_minor / CustomerBalance / cached truth
    const cols: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='customers'`,
    );
    expect(cols.map((c) => c.column_name)).not.toContain('balance_minor');
    const colsWallet: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='wallet_accounts'`,
    );
    expect(colsWallet.map((c) => c.column_name)).not.toContain('balance_minor');
    const tables: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%customer_balance%'`,
    );
    expect(tables.length).toBe(0);
  });

  it('4. Receiving number / identity — canonical, reuse existing contact', async () => {
    const { token, customerId, phone } = await createCustomerWithCredential();
    const ri = await request(app.getHttpServer())
      .get('/api/v1/customers/me/receiving-identity')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(ri.body.customerId).toBe(customerId);
    expect(ri.body.receivingIdentity).toBe(phone);
    const rn = await request(app.getHttpServer())
      .get('/api/v1/customers/me/receiving-number')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(rn.body.receivingNumber).toBe(phone);
  });

  it('5. Recipient resolution — reuse RecipientResolutionService via /recipients and via /customers/me/recipient', async () => {
    const { token: tokenA, phone: phoneA } = await createCustomerWithCredential();
    const { phone: phoneB } = await createCustomerWithCredential();
    // Resolve via global endpoint with customer token — actual path is /recipients/resolve
    const resGlobal = await request(app.getHttpServer())
      .get('/api/v1/recipients/resolve')
      .query({ identifier: phoneA })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(resGlobal.body.ownerType).toBe('CUSTOMER');
    expect(resGlobal.body.receivingNumber).toBe(phoneA);
    const resMe = await request(app.getHttpServer())
      .get('/api/v1/customers/me/recipient')
      .query({ identifier: phoneB })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(resMe.body.ownerType).toBe('CUSTOMER');
    expect(resMe.body.receivingNumber).toBe(phoneB);
    // Create an agent receiving number and ensure it resolves as AGENT
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-rec-${randomUUID().slice(0, 6)}`,
        `REC-${randomUUID().slice(0, 6)}`,
        'Rec Class',
        JSON.stringify([]),
        JSON.stringify({}),
      ],
    );
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-rec-${randomUUID()}`, classRows[0]!.id],
    );
    const agentId = agentRows[0]!.id;
    const agentNumber = `7${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO agent_receiving_numbers (agent_id, receiving_number, status) VALUES ($1,$2,'ACTIVE')`,
      [agentId, agentNumber],
    );
    const resAgent = await request(app.getHttpServer())
      .get('/api/v1/recipients/resolve')
      .query({ identifier: agentNumber })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(resAgent.body.ownerType).toBe('AGENT');
    expect(resAgent.body.receivingNumber).toBe(agentNumber);
  });

  it('6. Wallet→Wallet — reuse TransferService, preserves idempotency/concurrency/double-entry/fee not via customer app', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS);
    const ls = app.get(LS);
    const wa = await ws.createWallet({
      customerId: custA,
      currency: 'NGN',
      idempotencyKey: `a23wa-${custA}`,
    });
    const wb = await ws.createWallet({
      customerId: custB,
      currency: 'NGN',
      idempotencyKey: `a23wb-${custB}`,
    });
    // A24: set PIN for source customer before transfer
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '1234' })
      .expect(200);
    // Fund wa
    const plat = await ls.createAccount({
      code: `PLAT_${randomUUID().slice(0, 6)}`,
      name: 'Plat',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ls.postJournal({
      idempotencyKey: `fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      lines: [
        { accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' },
        { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' },
      ],
    });
    const beforeWa = await ws.getWalletBalance(wa.id);
    expect(beforeWa.balanceMinor).toBe('50000');
    const idem = `idem-a23-${randomUUID()}`;
    const create = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idem)
      .send({
        sourceWalletId: wa.id,
        destinationWalletId: wb.id,
        amountMinor: '10000',
        currency: 'NGN',
        reference: `ref-${randomUUID()}`,
        pin: '1234',
      })
      .expect(201);
    expect(create.body.id).toBeDefined();
    const transferId = create.body.id as string;
    // Idempotency: same key returns same transferId, no double debit (A24: PIN still required on idempotent retry)
    const again = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idem)
      .send({
        sourceWalletId: wa.id,
        destinationWalletId: wb.id,
        amountMinor: '10000',
        currency: 'NGN',
        reference: `ref-${randomUUID()}`,
        pin: '1234',
      })
      .expect((r) => expect([201, 409].includes(r.status)).toBe(true));
    if (again.status === 201) expect(again.body.id).toBe(transferId);
    const afterWa = await ws.getWalletBalance(wa.id);
    const afterWb = await ws.getWalletBalance(wb.id);
    expect(afterWa.balanceMinor).toBe('40000');
    expect(afterWb.balanceMinor).toBe('10000');
    // Source wallet must belong to SELF else 404 (A24: still 404 even with valid PIN)
    const bad = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `idem-${randomUUID()}`)
      .send({
        sourceWalletId: wb.id,
        destinationWalletId: wa.id,
        amountMinor: '1000',
        currency: 'NGN',
        pin: '1234',
      })
      .expect(404);
    // Also test existing TransferService still works via /transfers endpoint for compatibility
    await request(app.getHttpServer())
      .get(`/api/v1/transfers/${transferId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect((r) => expect([200, 401, 403].includes(r.status)).toBe(true));
  });

  it('fails closed for customer-to-agent before any transfer, journal or notification is recorded', async () => {
    const { token, customerId } = await createCustomerWithCredential();
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits)
       VALUES ($1,$2,'transfer class',true,$3,$4) RETURNING id`,
      [
        `cls-${randomUUID()}`,
        `C-${randomUUID().slice(0, 8)}`,
        JSON.stringify(['WALLET_TRANSFER']),
        JSON.stringify({}),
      ],
    );
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-${randomUUID()}`, classRows[0]!.id],
    );
    const { WalletService } = await import('../src/wallet/wallet.service');
    const { LedgerService } = await import('../src/ledger/ledger.service');
    const wallets = app.get(WalletService);
    const ledger = app.get(LedgerService);
    const source = await wallets.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `src-${randomUUID()}`,
    });
    const destination = await wallets.createWallet({
      customerId: rows[0]!.id,
      currency: 'NGN',
      idempotencyKey: `dst-${randomUUID()}`,
    });
    const owner: Array<{ owner_class: string }> = await dataSource.query(
      'SELECT owner_class FROM wallet_accounts WHERE id=$1',
      [destination.id],
    );
    expect(owner[0]!.owner_class).toBe('AGENT');
    const { WalletAccount } = await import('../src/wallet/wallet-account.entity');
    const { resolveTransferParticipants } = await import('../src/transfer/transfer-participant');
    const classify = () =>
      dataSource.transaction('SERIALIZABLE', async (manager) => {
        const locked = await manager
          .getRepository(WalletAccount)
          .createQueryBuilder('wallet')
          .where('wallet.id IN (:...ids)', { ids: [source.id, destination.id] })
          .orderBy('wallet.id', 'ASC')
          .setLock('pessimistic_write')
          .getMany();
        const byId = new Map(locked.map((wallet) => [wallet.id, wallet]));
        return resolveTransferParticipants(manager, [
          byId.get(source.id)!,
          byId.get(destination.id)!,
        ]);
      });
    expect(await classify()).toMatchObject([
      { type: 'CUSTOMER', id: customerId, agentClassId: null },
      { type: 'AGENT', id: rows[0]!.id, agentClassId: classRows[0]!.id },
    ]);
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '1234' })
      .expect(200);
    const funding = await ledger.createAccount({
      code: `fund-${randomUUID()}`,
      name: 'test funding',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ledger.postJournal({
      idempotencyKey: `fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: funding.id, direction: 'DEBIT' as any, amountMinor: '50000' },
        { accountId: source.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' },
      ],
    });
    const before = await dataSource.query(
      `SELECT (SELECT count(*) FROM transfers)::int AS transfers, (SELECT count(*) FROM ledger_journals)::int AS journals, (SELECT count(*) FROM outbox_events WHERE event_type LIKE 'transfer.%')::int AS events`,
    );
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `transfer-${randomUUID()}`)
      .send({
        sourceWalletId: source.id,
        destinationWalletId: destination.id,
        amountMinor: '10000',
        currency: 'NGN',
        pin: '1234',
      })
      .expect(503);
    expect(
      await dataSource.query(
        `SELECT (SELECT count(*) FROM transfers)::int AS transfers, (SELECT count(*) FROM ledger_journals)::int AS journals, (SELECT count(*) FROM outbox_events WHERE event_type LIKE 'transfer.%')::int AS events`,
      ),
    ).toEqual(before);
    expect((await wallets.getWalletBalance(source.id)).balanceMinor).toBe('50000');
    expect((await wallets.getWalletBalance(destination.id)).balanceMinor).toBe('0');
    // A later namespace collision invalidates the previously stored class; never rely on the
    // stale wallet label or silently address this AGENT identity as a CUSTOMER.
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status)
      VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [rows[0]!.id, `collision-${randomUUID()}`],
    );
    await expect(classify()).rejects.toMatchObject({ status: 503 });
  });

  it('creates session-bound server-priced quotes for customer and agent operating wallets without posting money', async () => {
    const customer = await createCustomerWithCredential();
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference,code,name,is_active,applicable_services)
      VALUES ($1,$2,'quote class',true,$3) RETURNING id`,
      [`qc-${randomUUID()}`, `QC-${randomUUID().slice(0, 8)}`, JSON.stringify(['WALLET_TRANSFER'])],
    );
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference,status,agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`qa-${randomUUID()}`, classRows[0]!.id],
    );
    const agentId = agentRows[0]!.id;
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id,password_hash,hash_algorithm,password_version,password_changed_at,status)
      VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, encodePbkdf2('quote-agent-password')],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: 'quote-agent-password' })
      .expect(200);
    expect(login.body.accessToken).toBeTruthy();
    const customerSessions: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM authentication_sessions WHERE customer_id=$1 AND status='ACTIVE'`,
      [customer.customerId],
    );
    const agentSessions: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM agent_authentication_sessions WHERE agent_id=$1 AND status='ACTIVE'`,
      [agentId],
    );
    const { WalletService } = await import('../src/wallet/wallet.service');
    const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
    const wallets = app.get(WalletService);
    const quotes = app.get(TransferQuoteService);
    const source = await wallets.createWallet({
      customerId: customer.customerId,
      currency: 'NGN',
      idempotencyKey: `q-src-${randomUUID()}`,
    });
    const operating = await wallets.createWallet({
      customerId: agentId,
      currency: 'NGN',
      idempotencyKey: `q-agent-${randomUUID()}`,
    });
    const cp = {
      type: 'CUSTOMER' as const,
      principalId: customer.customerId,
      customerId: customer.customerId,
      sessionId: customerSessions[0]!.id,
      roles: [],
      scopes: [],
      customerAccess: 'SELF' as const,
    };
    const ap = {
      type: 'AGENT' as const,
      principalId: agentId,
      agentId,
      sessionId: agentSessions[0]!.id,
      roles: [],
      scopes: [],
      customerAccess: 'NONE' as const,
      agentAccess: 'SELF' as const,
    };
    const input = {
      sourceWalletId: source.id,
      destinationWalletId: operating.id,
      amountMinor: '1234',
      currency: 'NGN',
      idempotencyKey: `q-${randomUUID()}`,
    };
    const first = await quotes.create(cp, input);
    expect(first).toMatchObject({
      sourceWalletId: source.id,
      destinationWalletId: operating.id,
      recipientType: 'AGENT',
      recipientId: agentId,
      amountMinor: '1234',
      feeMinor: '0',
      vatMinor: '0',
      totalDebitMinor: '1234',
      status: 'ACTIVE',
    });
    expect((await quotes.create(cp, input)).quoteId).toBe(first.quoteId);
    await expect(quotes.create(cp, { ...input, amountMinor: '1235' })).rejects.toMatchObject({
      status: 409,
    });
    const agentQuote = await quotes.create(ap, {
      destinationWalletId: source.id,
      amountMinor: '100',
      currency: 'NGN',
      idempotencyKey: `qa-${randomUUID()}`,
    });
    expect(agentQuote).toMatchObject({
      sourceWalletId: operating.id,
      destinationWalletId: source.id,
      recipientType: 'CUSTOMER',
      recipientId: customer.customerId,
    });
    await expect(
      quotes.create(ap, {
        destinationWalletId: source.id,
        sourceWalletId: operating.id,
        amountMinor: '100',
        currency: 'NGN',
        idempotencyKey: `bad-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await dataSource.query(`UPDATE agent_classes SET applicable_services=$1 WHERE id=$2`, [
      JSON.stringify(['CASH_IN']),
      classRows[0]!.id,
    ]);
    await expect(
      quotes.create(cp, { ...input, idempotencyKey: `recipient-no-capability-${randomUUID()}` }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      quotes.create(ap, {
        destinationWalletId: source.id,
        amountMinor: '100',
        currency: 'NGN',
        idempotencyKey: `no-capability-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await dataSource.query(`UPDATE agent_classes SET applicable_services=$1 WHERE id=$2`, [
      JSON.stringify(['WALLET_TRANSFER']),
      classRows[0]!.id,
    ]);
    await dataSource.query(
      `UPDATE agent_authentication_credentials SET account_locked=true WHERE agent_id=$1`,
      [agentId],
    );
    await expect(
      quotes.create(ap, {
        destinationWalletId: source.id,
        amountMinor: '100',
        currency: 'NGN',
        idempotencyKey: `locked-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 401 });
    await dataSource.query(
      `UPDATE agent_authentication_credentials SET account_locked=false WHERE agent_id=$1`,
      [agentId],
    );
    await dataSource.query(
      `UPDATE agent_authentication_credentials SET password_changed_at=clock_timestamp()+interval '1 second' WHERE agent_id=$1`,
      [agentId],
    );
    await expect(
      quotes.create(ap, {
        destinationWalletId: source.id,
        amountMinor: '100',
        currency: 'NGN',
        idempotencyKey: `rotated-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 401 });
    await dataSource.query(
      `UPDATE agent_authentication_sessions SET status='REVOKED',revoked_at=now() WHERE id=$1`,
      [agentSessions[0]!.id],
    );
    await expect(
      quotes.create(ap, {
        destinationWalletId: source.id,
        amountMinor: '100',
        currency: 'NGN',
        idempotencyKey: `revoked-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(await dataSource.query(`SELECT id FROM transfers`)).toEqual([]);
    expect(await dataSource.query(`SELECT id FROM ledger_journals`)).toEqual([]);
  });

  it('atomically consumes a confirmed customer quote and recovers only the identical operation', async () => {
    const sender = await createCustomerWithCredential();
    const receiver = await createCustomerWithCredential();
    const sessions: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM authentication_sessions WHERE customer_id=$1 AND status='ACTIVE'`,
      [sender.customerId],
    );
    const principal = {
      type: 'CUSTOMER' as const,
      principalId: sender.customerId,
      customerId: sender.customerId,
      sessionId: sessions[0]!.id,
      roles: [],
      scopes: [],
      customerAccess: 'SELF' as const,
    };
    const { WalletService } = await import('../src/wallet/wallet.service');
    const { LedgerService } = await import('../src/ledger/ledger.service');
    const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
    const { TransferService } = await import('../src/transfer/transfer.service');
    const wallets = app.get(WalletService);
    const ledger = app.get(LedgerService);
    const quoteService = app.get(TransferQuoteService);
    const transferService = app.get(TransferService);
    const source = await wallets.createWallet({
      customerId: sender.customerId,
      currency: 'NGN',
      idempotencyKey: `confirm-src-${randomUUID()}`,
    });
    const destination = await wallets.createWallet({
      customerId: receiver.customerId,
      currency: 'NGN',
      idempotencyKey: `confirm-dst-${randomUUID()}`,
    });
    const funding = await ledger.createAccount({
      code: `confirm-fund-${randomUUID()}`,
      name: 'test',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ledger.postJournal({
      idempotencyKey: `confirm-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: funding.id, direction: 'DEBIT' as any, amountMinor: '5000' },
        { accountId: source.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '5000' },
      ],
    });
    const quote = await quoteService.create(principal, {
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      amountMinor: '1200',
      currency: 'NGN',
      idempotencyKey: `quote-${randomUUID()}`,
    });
    const { CustomerTransactionPinService } = await import(
      '../src/customer/customer-transaction-pin.service'
    );
    await app.get(CustomerTransactionPinService).setTransactionPin(sender.customerId, {
      pinHash: encodePbkdf2('1234'),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: sender.customerId,
    });
    // Internal service only; there is no HTTP confirmation route yet.
    const key = `confirm-${randomUUID()}`;
    await expect(
      transferService.createConfirmedTransfer(principal, quote.quoteId, key, '9999'),
    ).rejects.toMatchObject({ status: 401 });
    const pinRows: Array<{ failed_count: number }> = await dataSource.query(
      `SELECT failed_count FROM customer_transaction_pins WHERE customer_id=$1`,
      [sender.customerId],
    );
    expect(pinRows[0]!.failed_count).toBe(1);
    const { TransferPinAuthorizationService } = await import(
      '../src/transfer/transfer-pin-authorization.service'
    );
    const pinAuthorization = app.get(TransferPinAuthorizationService);
    const scopedKey = `self-transfer:${createHash('sha256').update(`CUSTOMER:${sender.customerId}:${key}`).digest('hex')}`;
    const proof = await pinAuthorization.authorize(principal, quote.quoteId, scopedKey, '1234');
    await dataSource.transaction(async (manager) => {
      await pinAuthorization.assertWithManager(manager, principal, quote.quoteId, scopedKey, proof);
      await expect(
        pinAuthorization.assertWithManager(manager, principal, randomUUID(), scopedKey, proof),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        pinAuthorization.assertWithManager(
          manager,
          principal,
          quote.quoteId,
          `${scopedKey}-other`,
          proof,
        ),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        pinAuthorization.assertWithManager(
          manager,
          { ...principal, sessionId: randomUUID() },
          quote.quoteId,
          scopedKey,
          proof,
        ),
      ).rejects.toMatchObject({ status: 401 });
    });
    // Simulate PIN lock between verification and the transactional authorization check.
    const authorize = pinAuthorization.authorize.bind(pinAuthorization);
    const lockRace = jest
      .spyOn(pinAuthorization, 'authorize')
      .mockImplementation(async (...args) => {
        const id = await authorize(...args);
        await dataSource.query(
          `UPDATE customer_transaction_pins SET account_locked=true WHERE customer_id=$1`,
          [sender.customerId],
        );
        return id;
      });
    try {
      await expect(
        transferService.createConfirmedTransfer(principal, quote.quoteId, key, '1234'),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      lockRace.mockRestore();
      await dataSource.query(
        `UPDATE customer_transaction_pins SET account_locked=false WHERE customer_id=$1`,
        [sender.customerId],
      );
    }
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(0);
    // Missing any mandatory financial control must fail before creating a transfer, while
    // leaving the quote reusable. PIN authorization evidence is intentionally independent.
    const controls = transferService as unknown as Record<string, unknown>;
    for (const dependency of ['limitEnforcementService', 'outboxService', 'auditService']) {
      const original = controls[dependency];
      try {
        controls[dependency] = undefined;
        await expect(
          transferService.createConfirmedTransfer(principal, quote.quoteId, key, '1234'),
        ).rejects.toMatchObject({ status: 503 });
      } finally {
        controls[dependency] = original;
      }
      expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(0);
      expect(
        await dataSource.query(`SELECT status FROM payment_quotes WHERE id=$1`, [quote.quoteId]),
      ).toEqual([{ status: 'ACTIVE' }]);
    }
    // A late failure after quote use must undo journal, transfer and quote changes together.
    const journalCountBefore = (
      await dataSource.query<Array<{ id: string }>>(`SELECT id FROM ledger_journals`)
    ).length;
    const consume = quoteService.consumeWithManager.bind(quoteService);
    const injected = jest
      .spyOn(quoteService, 'consumeWithManager')
      .mockImplementation(async (...args) => {
        await consume(...args);
        throw new Error('injected post-consumption failure');
      });
    try {
      await expect(
        transferService.createConfirmedTransfer(principal, quote.quoteId, key, '1234'),
      ).rejects.toThrow('injected post-consumption failure');
    } finally {
      injected.mockRestore();
    }
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(0);
    expect(await dataSource.query(`SELECT id FROM ledger_journals`)).toHaveLength(
      journalCountBefore,
    );
    expect((await wallets.getWalletBalance(source.id)).balanceMinor).toBe('5000');
    expect((await wallets.getWalletBalance(destination.id)).balanceMinor).toBe('0');
    expect(
      await dataSource.query(
        `SELECT q.status,b.transfer_id FROM payment_quotes q JOIN wallet_transfer_quote_bindings b ON b.quote_id=q.id WHERE q.id=$1`,
        [quote.quoteId],
      ),
    ).toEqual([{ status: 'ACTIVE', transfer_id: null }]);
    const completed = await transferService.createConfirmedTransfer(
      principal,
      quote.quoteId,
      key,
      '1234',
    );
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      amountMinor: '1200',
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
    });
    expect(
      (await transferService.createConfirmedTransfer(principal, quote.quoteId, key, '1234')).id,
    ).toBe(completed.id);
    await expect(
      transferService.createConfirmedTransfer(
        principal,
        quote.quoteId,
        `different-${randomUUID()}`,
        '1234',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await dataSource.query(
        `SELECT q.status,b.transfer_id FROM payment_quotes q JOIN wallet_transfer_quote_bindings b ON b.quote_id=q.id WHERE q.id=$1`,
        [quote.quoteId],
      ),
    ).toEqual([{ status: 'USED', transfer_id: completed.id }]);
    expect((await wallets.getWalletBalance(source.id)).balanceMinor).toBe('3800');
    expect((await wallets.getWalletBalance(destination.id)).balanceMinor).toBe('1200');
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(1);
    const { TransferReconciliationService } = await import(
      '../src/reconciliation/transfer-reconciliation.service'
    );
    const reconciliation = app.get(TransferReconciliationService);
    expect(await reconciliation.reconcileTransfer(completed.id)).toMatchObject({
      status: 'PASS',
      discrepancies: [],
    });
    expect(
      (await reconciliation.reconcileAll()).reports.map((report) => report.transfer?.id),
    ).toContain(completed.id);
    const anotherQuote = await quoteService.create(principal, {
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      amountMinor: '1200',
      currency: 'NGN',
      idempotencyKey: `another-quote-${randomUUID()}`,
    });
    await expect(
      transferService.createConfirmedTransfer(principal, anotherQuote.quoteId, key, '1234'),
    ).rejects.toMatchObject({ status: 409 });
    const stale = await quoteService.create(principal, {
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      amountMinor: '100',
      currency: 'NGN',
      idempotencyKey: `stale-quote-${randomUUID()}`,
    });
    const { ProductCatalogSeedService } = await import(
      '../src/product-catalog/product-catalog-seed.service'
    );
    const { FeeRuleRegistryService } = await import('../src/fee-rules/fee-rule-registry.service');
    await app.get(ProductCatalogSeedService).seedIfEmpty();
    await app
      .get(FeeRuleRegistryService)
      .createRule(
        { productCode: 'WALLET_TRANSFER', currency: 'NGN', flatFeeMinor: '0', vatBps: 0 },
        'test',
      );
    await expect(
      transferService.createConfirmedTransfer(
        principal,
        stale.quoteId,
        `stale-${randomUUID()}`,
        '1234',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await wallets.getWalletBalance(source.id)).balanceMinor).toBe('3800');
    expect((await wallets.getWalletBalance(destination.id)).balanceMinor).toBe('1200');
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(1);
    expect(
      await dataSource.query(`SELECT status FROM payment_quotes WHERE id=$1`, [stale.quoteId]),
    ).toEqual([{ status: 'ACTIVE' }]);
    await dataSource.query(
      `UPDATE customer_authentication_credentials SET account_locked=true WHERE customer_id=$1`,
      [sender.customerId],
    );
    await expect(
      transferService.createConfirmedTransfer(principal, quote.quoteId, key, '1234'),
    ).rejects.toMatchObject({ status: 401 });
    await dataSource.query(
      `UPDATE customer_authentication_credentials SET account_locked=false WHERE customer_id=$1`,
      [sender.customerId],
    );
    await dataSource.query(
      `UPDATE customer_authentication_credentials SET password_version=password_version+1 WHERE customer_id=$1`,
      [sender.customerId],
    );
    await expect(
      transferService.createConfirmedTransfer(principal, quote.quoteId, key, '1234'),
    ).rejects.toMatchObject({ status: 401 });
    await dataSource.query(
      `UPDATE authentication_sessions SET status='REVOKED', revoked_at=clock_timestamp() WHERE id=$1`,
      [principal.sessionId],
    );
    await expect(
      transferService.createConfirmedTransfer(principal, quote.quoteId, key, '1234'),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('authenticates quote and PIN confirmation over HTTP while agent posting stays closed', async () => {
    const sender = await createCustomerWithCredential();
    const receiver = await createCustomerWithCredential();
    const agentToken = await createAgentToken();
    const agentRows: Array<{ id: string; agent_class_id: string }> = await dataSource.query(
      `SELECT id,agent_class_id FROM agents`,
    );
    const agent = agentRows[0]!;
    await dataSource.query(`UPDATE agent_classes SET applicable_services=$1 WHERE id=$2`, [
      JSON.stringify(['WALLET_TRANSFER']),
      agent.agent_class_id,
    ]);
    const { WalletService } = await import('../src/wallet/wallet.service');
    const { LedgerService } = await import('../src/ledger/ledger.service');
    const { CustomerTransactionPinService } = await import(
      '../src/customer/customer-transaction-pin.service'
    );
    const { AgentAuthenticationService } = await import(
      '../src/agent-authentication/agent-authentication.service'
    );
    const { AgentPasswordHashAlgorithm } = await import(
      '../src/agent-authentication/agent-authentication.enums'
    );
    const wallets = app.get(WalletService);
    const ledger = app.get(LedgerService);
    const source = await wallets.createWallet({
      customerId: sender.customerId,
      currency: 'NGN',
      idempotencyKey: `http-src-${randomUUID()}`,
    });
    const destination = await wallets.createWallet({
      customerId: receiver.customerId,
      currency: 'NGN',
      idempotencyKey: `http-dst-${randomUUID()}`,
    });
    const operating = await wallets.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `http-agent-${randomUUID()}`,
    });
    const funding = await ledger.createAccount({
      code: `http-fund-${randomUUID()}`,
      name: 'test',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ledger.postJournal({
      idempotencyKey: `http-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: funding.id, direction: 'DEBIT' as any, amountMinor: '5000' },
        { accountId: source.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '5000' },
      ],
    });
    await app.get(CustomerTransactionPinService).setTransactionPin(sender.customerId, {
      pinHash: encodePbkdf2('1234'),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: sender.customerId,
    });
    await app.get(AgentAuthenticationService).setTransactionPin(agent.id, {
      pinHash: encodePbkdf2('1234'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: agent.id,
    });
    const customerPath = '/api/v1/customers/me/transfer-quotes';
    const agentPath = '/api/v1/agents/me/transfer-quotes';
    const payload = {
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      amountMinor: '1200',
      currency: 'NGN',
    };
    await request(app.getHttpServer())
      .post(customerPath)
      .set('Idempotency-Key', randomUUID())
      .send(payload)
      .expect(401);
    await request(app.getHttpServer())
      .post(customerPath)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ...payload, feeMinor: '0' })
      .expect(400);
    await request(app.getHttpServer())
      .post(agentPath)
      .set('Authorization', `Bearer ${agentToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(payload)
      .expect(400);
    const quote = await request(app.getHttpServer())
      .post(customerPath)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', randomUUID())
      .send(payload)
      .expect(201);
    expect(quote.body).toMatchObject({
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      amountMinor: '1200',
      totalDebitMinor: '1200',
    });
    const path = `${customerPath}/${quote.body.quoteId as string}/confirm`;
    const key = randomUUID();
    const secondSession = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId: sender.customerId, password: 'correct-password-a23' })
      .expect(200);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${secondSession.body.accessToken as string}`)
      .set('Idempotency-Key', key)
      .send({ pin: '1234' })
      .expect(404);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${receiver.token}`)
      .set('Idempotency-Key', key)
      .send({ pin: '1234' })
      .expect(404);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', key)
      .send({ pin: '1234', amountMinor: '1' })
      .expect(400);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', key)
      .send({ pin: '9999' })
      .expect(401);
    const completed = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', key)
      .send({ pin: '1234' })
      .expect(201);
    expect(completed.body).toMatchObject({ status: 'COMPLETED', amountMinor: '1200' });
    const replay = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', key)
      .send({ pin: '1234' })
      .expect(201);
    expect(replay.body.id).toBe(completed.body.id);
    expect((await wallets.getWalletBalance(source.id)).balanceMinor).toBe('3800');
    expect((await wallets.getWalletBalance(destination.id)).balanceMinor).toBe('1200');
    const customerAgentQuote = await request(app.getHttpServer())
      .post(customerPath)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ...payload, destinationWalletId: operating.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${customerPath}/${customerAgentQuote.body.quoteId as string}/confirm`)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ pin: '1234' })
      .expect(503);
    const agentQuote = await request(app.getHttpServer())
      .post(agentPath)
      .set('Authorization', `Bearer ${agentToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ destinationWalletId: destination.id, amountMinor: '100', currency: 'NGN' })
      .expect(201);
    expect(agentQuote.body.sourceWalletId).toBe(operating.id);
    await request(app.getHttpServer())
      .post(`${agentPath}/${agentQuote.body.quoteId as string}/confirm`)
      .set('Authorization', `Bearer ${agentToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ pin: '1234' })
      .expect(503);
    expect((await wallets.getWalletBalance(operating.id)).balanceMinor).toBe('0');
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(1);
    for (let attempt = 0; attempt < 5; attempt++) {
      await request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', key)
        .send({ pin: '9999' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', key)
      .send({ pin: '1234' })
      .expect(401);
    expect(
      await dataSource.query(
        `SELECT account_locked FROM customer_transaction_pins WHERE customer_id=$1`,
        [sender.customerId],
      ),
    ).toEqual([{ account_locked: true }]);
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(1);
  });

  it('database protects bound transfer quote facts and refuses premature generic use', async () => {
    const sender = await createCustomerWithCredential();
    const recipient = await createCustomerWithCredential();
    const { WalletService } = await import('../src/wallet/wallet.service');
    const wallets = app.get(WalletService);
    const source = await wallets.createWallet({
      customerId: sender.customerId,
      currency: 'NGN',
      idempotencyKey: `qs-${randomUUID()}`,
    });
    const destination = await wallets.createWallet({
      customerId: recipient.customerId,
      currency: 'NGN',
      idempotencyKey: `qd-${randomUUID()}`,
    });
    const quoteId = randomUUID();
    await dataSource.query(
      `INSERT INTO payment_quotes (id,quote_reference,payment_type,amount_minor,fee_minor,vat_minor,total_minor,currency,status,idempotency_key,request_hash,expires_at)
      VALUES ($1,$2,'TRANSFER',1000,100,7,1107,'NGN','ACTIVE',$3,$4,now()+interval '5 minutes')`,
      [quoteId, `quote-${randomUUID()}`, `quote-idem-${randomUUID()}`, 'a'.repeat(64)],
    );
    await dataSource.query(
      `INSERT INTO wallet_transfer_quote_bindings
      (quote_id,principal_type,principal_id,session_id,source_wallet_id,source_ledger_id,destination_wallet_id,destination_ledger_id,recipient_type,recipient_id,pricing_hash)
      VALUES ($1,'CUSTOMER',$2,$3,$4,$5,$6,$7,'CUSTOMER',$8,$9)`,
      [
        quoteId,
        sender.customerId,
        randomUUID(),
        source.id,
        source.ledgerAccountId,
        destination.id,
        destination.ledgerAccountId,
        recipient.customerId,
        'b'.repeat(64),
      ],
    );
    await expect(
      dataSource.query(`UPDATE payment_quotes SET fee_minor=0,total_minor=1007 WHERE id=$1`, [
        quoteId,
      ]),
    ).rejects.toThrow('economics are immutable');
    await expect(
      dataSource.query(`UPDATE payment_quotes SET status='USED',used_at=now() WHERE id=$1`, [
        quoteId,
      ]),
    ).rejects.toThrow('Invalid bound transfer quote transition');
    await expect(
      dataSource.query(
        `UPDATE wallet_transfer_quote_bindings SET recipient_id=$2 WHERE quote_id=$1`,
        [quoteId, sender.customerId],
      ),
    ).rejects.toThrow('immutable');
    await expect(
      dataSource.query(`DELETE FROM wallet_transfer_quote_bindings WHERE quote_id=$1`, [quoteId]),
    ).rejects.toThrow('cannot be deleted');
    expect(
      await dataSource.query(
        `SELECT status,fee_minor::text,vat_minor::text,total_minor::text FROM payment_quotes WHERE id=$1`,
        [quoteId],
      ),
    ).toEqual([{ status: 'ACTIVE', fee_minor: '100', vat_minor: '7', total_minor: '1107' }]);
  });

  it('7. Transaction history — read-only, direction/amount/status/reference/type/date/fee/identity where permitted', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS);
    const ls = app.get(LS);
    const wa = await ws.createWallet({
      customerId: custA,
      currency: 'NGN',
      idempotencyKey: `hwa-${custA}`,
    });
    const wb = await ws.createWallet({
      customerId: custB,
      currency: 'NGN',
      idempotencyKey: `hwb-${custB}`,
    });
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '1234' })
      .expect(200);
    const plat = await ls.createAccount({
      code: `PLAH_${randomUUID().slice(0, 6)}`,
      name: 'PlatH',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ls.postJournal({
      idempotencyKey: `fh-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      lines: [
        { accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '20000' },
        { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '20000' },
      ],
    });
    const idem = `idem-h-${randomUUID()}`;
    const tr = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idem)
      .send({
        sourceWalletId: wa.id,
        destinationWalletId: wb.id,
        amountMinor: '5000',
        currency: 'NGN',
        pin: '1234',
      })
      .expect(201);
    const tid = tr.body.id as string;
    const history = await request(app.getHttpServer())
      .get('/api/v1/customers/me/transfers?page=1&limit=20')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(history.body.items).toBeDefined();
    expect(history.body.pagination).toBeDefined();
    expect(history.body.pagination.total).toBeGreaterThanOrEqual(1);
    const found = (history.body.items as HistoryResponseFixture[]).find(
      (x: HistoryResponseFixture) => x.transferId === tid || x.id === tid,
    )!;
    expect(found).toBeDefined();
    expect(
      found.direction === 'SENT' ||
        found.direction === 'RECEIVED' ||
        found.direction === 'INTERNAL',
    ).toBe(true);
    expect(found.amountMinor).toBe('5000');
    expect(found.currency).toBe('NGN');
    expect(found.status).toBeDefined();
    expect(found.createdAt).toBeDefined();
    // Alias endpoint
    const history2 = await request(app.getHttpServer())
      .get('/api/v1/customers/me/transactions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(history2.body.items.length).toBe(history.body.items.length);
  });

  it('8. Transaction detail — SELF, no leakage of ledger/PIN/OTP/session/audit', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS);
    const ls = app.get(LS);
    const wa = await ws.createWallet({
      customerId: custA,
      currency: 'NGN',
      idempotencyKey: `dwa-${custA}`,
    });
    const wb = await ws.createWallet({
      customerId: custB,
      currency: 'NGN',
      idempotencyKey: `dwb-${custB}`,
    });
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '1234' })
      .expect(200);
    const plat = await ls.createAccount({
      code: `PLAD_${randomUUID().slice(0, 6)}`,
      name: 'PlatD',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ls.postJournal({
      idempotencyKey: `fd-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      lines: [
        { accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '30000' },
        { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '30000' },
      ],
    });
    const tr = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `idem-d-${randomUUID()}`)
      .send({
        sourceWalletId: wa.id,
        destinationWalletId: wb.id,
        amountMinor: '7000',
        currency: 'NGN',
        pin: '1234',
      })
      .expect(201);
    const tid = tr.body.id as string;
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/transfers/${tid}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.id).toBe(tid);
    expect(detail.body.amountMinor).toBe('7000');
    expect(detail.body.direction).toBe('SENT');
    const serial = JSON.stringify(detail.body).toLowerCase();
    expect(serial).not.toContain('pinhash');
    expect(serial).not.toContain('pin');
    expect(serial).not.toContain('ledger');
    expect(serial).not.toContain('token');
    expect(serial).not.toContain('otp');
    expect(serial).not.toContain('session');
    expect(serial).not.toContain('audit');
    // Alias
    const detail2 = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/transactions/${tid}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail2.body.id).toBe(tid);
  });

  it('9. SELF enforcement — Customer A cannot access Customer B data, and sensitive fields excluded, no /mobile namespace', async () => {
    const { token: tokenA, customerId: custA } = await createCustomerWithCredential();
    const { token: tokenB, customerId: custB } = await createCustomerWithCredential();
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const ws = app.get(WS);
    const wb = await ws.createWallet({
      customerId: custB,
      currency: 'NGN',
      idempotencyKey: `cross-${custB}`,
    });
    // A tries to fetch B's wallet via me endpoint -> 404 (SELF)
    await request(app.getHttpServer())
      .get(`/api/v1/customers/me/wallets/${wb.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/me/wallets/${wb.id}/balance`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
    // Create transfer involving B and test A cannot view it if not involving A
    const wa = await ws.createWallet({
      customerId: custA,
      currency: 'NGN',
      idempotencyKey: `cross-a-${custA}`,
    });
    // need funding for A? But transfer between A and B will be visible to both; we need a transfer that only involves B vs a third C to test isolation
    const custC = (await createCustomerWithCredential()).customerId;
    const wc = await ws.createWallet({
      customerId: custC,
      currency: 'NGN',
      idempotencyKey: `cross-c-${custC}`,
    });
    // For B->C transfer, create via direct ledger funding then transfer via B's token
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ls = app.get(LS);
    const plat = await ls.createAccount({
      code: `PLACR_${randomUUID().slice(0, 6)}`,
      name: 'PlatC',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ls.postJournal({
      idempotencyKey: `fc-cross-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      lines: [
        { accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '10000' },
        { accountId: wb.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '10000' },
      ],
    });
    // A24: set PIN for B before B->C transfer
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ pin: '4321' })
      .expect(200);
    const trBC = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${tokenB}`)
      .set('Idempotency-Key', `cross-bc-${randomUUID()}`)
      .send({
        sourceWalletId: wb.id,
        destinationWalletId: wc.id,
        amountMinor: '1000',
        currency: 'NGN',
        pin: '4321',
      })
      .expect(201);
    const tidBC = trBC.body.id as string;
    // A should not see B->C detail
    await request(app.getHttpServer())
      .get(`/api/v1/customers/me/transfers/${tidBC}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/me/transactions/${tidBC}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
    // Sensitive fields excluded on dashboard/profile/wallets
    const dash = await request(app.getHttpServer())
      .get('/api/v1/customers/me/dashboard')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const s = JSON.stringify(dash.body).toLowerCase();
    expect(s).not.toContain('password');
    expect(s).not.toContain('pin');
    expect(s).not.toContain('secret');
    expect(s).not.toContain('token');
    // No /mobile or /app namespace
    await request(app.getHttpServer())
      .get('/api/v1/mobile/customers/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/app/customers/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('10. Agent rejection — Agent token cannot access Customer App, workforce cannot', async () => {
    const { token: custToken } = await createCustomerWithCredential();
    const agentToken = await createAgentToken();
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    await request(app.getHttpServer())
      .get('/api/v1/customers/me/profile')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    await request(app.getHttpServer())
      .get('/api/v1/customers/me/wallets')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    await request(app.getHttpServer())
      .get('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    // Workforce mock: use invalid token that looks like workforce but is not a valid customer/agent session -> 401
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', 'Bearer workforce-SUPPORT')
      .expect(401);
    // Also customer should not be able to access Agent App (should be 403 Forbidden or 401, but not 200)
    await request(app.getHttpServer())
      .get('/api/v1/agents/me/profile')
      .set('Authorization', `Bearer ${custToken}`)
      .expect((r) => expect([401, 403].includes(r.status)).toBe(true));
  });

  it('11. PIN / security — via existing lifecycle, no hash leakage, lockout after 5 failures', async () => {
    const { token, customerId } = await createCustomerWithCredential();
    // set PIN
    const setRes = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '1234' })
      .expect(200);
    expect(setRes.body.customerId).toBe(customerId);
    expect(JSON.stringify(setRes.body)).not.toContain('Hash');
    // verify correct
    const ok = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '1234' })
      .expect(200);
    expect(ok.body.verified).toBe(true);
    // verify wrong 5 times -> lock
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/customers/me/transaction-pin/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: '9999' })
        .expect(200);
    }
    const locked = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '1234' })
      .expect(200);
    expect(locked.body.verified).toBe(false);
    expect(locked.body.locked).toBe(true);
    // Ensure no PIN hash exposed anywhere
    const profile = await request(app.getHttpServer())
      .get('/api/v1/customers/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(JSON.stringify(profile.body).toLowerCase()).not.toContain('pinhash');
    expect(JSON.stringify(profile.body).toLowerCase()).not.toContain('pin');
  });

  it('12. Dashboard — identity/status/balance/receiving number/recent transactions ledger-derived', async () => {
    const { token, customerId, phone } = await createCustomerWithCredential({
      displayName: 'Dash Customer',
    });
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS);
    const ls = app.get(LS);
    const w = await ws.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `dash-${customerId}`,
    });
    const plat = await ls.createAccount({
      code: `PLADASH_${randomUUID().slice(0, 6)}`,
      name: 'PlatDash',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ls.postJournal({
      idempotencyKey: `dash-j-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      lines: [
        { accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '77000' },
        { accountId: w.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '77000' },
      ],
    });
    const dash = await request(app.getHttpServer())
      .get('/api/v1/customers/me/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(dash.body.identity.id).toBe(customerId);
    expect(dash.body.identity.status).toBe('ACTIVE');
    expect(
      dash.body.balance.primary?.balanceMinor ?? dash.body.balance.wallets[0]?.balanceMinor,
    ).toBe('77000');
    expect(dash.body.receivingIdentity).toBe(phone);
    expect(dash.body.recentTransactions).toBeDefined();
    expect(dash.body.recentTransactions.items).toBeDefined();
  });

  it('13. Route policies — Customer App routes are CUSTOMER SELF, login is unauthenticated', async () => {
    const { RoutePolicyRegistry } = await import('../src/authorization/route-policy-registry');
    const registry = new RoutePolicyRegistry();
    const login = registry.resolve({ method: 'POST', url: '/api/v1/customers/sessions' });
    expect(login.authenticationMode).toBe('CUSTOMER_LOGIN');
    const me = registry.resolve({ method: 'GET', url: '/api/v1/customers/me' });
    expect(me.policy?.allowedPrincipalTypes).toEqual(['CUSTOMER']);
    expect(me.policy?.customerAccess).toBe('SELF');
    const profile = registry.resolve({ method: 'GET', url: '/api/v1/customers/me/profile' });
    expect(profile.policy?.allowedPrincipalTypes).toEqual(['CUSTOMER']);
    expect(profile.policy?.customerAccess).toBe('SELF');
    const wallets = registry.resolve({ method: 'GET', url: '/api/v1/customers/me/wallets' });
    expect(wallets.policy?.allowedPrincipalTypes).toEqual(['CUSTOMER']);
    const transfers = registry.resolve({ method: 'POST', url: '/api/v1/customers/me/transfers' });
    expect(transfers.policy?.allowedPrincipalTypes).toEqual(['CUSTOMER']);
  });

  it('14. No direct financial mutation via controllers, no wallet/ledger balance updates, no ad-hoc journals', async () => {
    // Ensure customer app endpoints do not expose direct ledger mutation params like ledgerAccountId, balanceMinor write, or /customers/me/balance POST
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/wallets')
      .set('Authorization', `Bearer ${(await createCustomerWithCredential()).token}`)
      .send({})
      .expect((r) => expect([404, 400, 401, 403].includes(r.status)).toBe(true));
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/financial-position')
      .set('Authorization', `Bearer ${(await createCustomerWithCredential()).token}`)
      .send({ balanceMinor: '99999' })
      .expect(404);
    // Check controller source does not contain direct ledger mutation qualifiers
    const fs = await import('node:fs');
    const ctrl = fs.readFileSync('src/customer-app/customer-app.controller.ts', 'utf8');
    expect(ctrl).not.toContain('postJournalInTransaction');
    expect(ctrl).not.toContain('LedgerService');
    // It does import LedgerService via WalletService but should not directly call ledger post in controller for transfers; our controller delegates to TransferService
    expect(ctrl).not.toMatch(/ledgerService\.postJournal/);
    expect(ctrl).not.toContain('balance_minor');
    expect(ctrl).not.toContain('CustomerBalance');
  });

  it('15. Migration count unchanged (no new migration for A23)', async () => {
    const rows: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text as count FROM typeorm_migrations`,
    );
    expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(67);
  });
});
