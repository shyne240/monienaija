/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

/**
 * V1-W2W-RECOVERY-SECURITY-AUDIT-01 — regression evidence for the audit documented at
 * docs/V1/V1-W2W-RECOVERY-SECURITY-AUDIT-01.md.
 *
 * This suite does NOT exercise any mobile "TransferRecoveryService" / "probeRecovery"
 * heuristic-matching mechanism, because no such mechanism exists anywhere in this
 * repository's current HEAD or its full git history (verified by `git log --all -S` pickaxe
 * search — see the audit doc, PART 1). apps/customer-mobile's SendMoneyScreen never probes
 * transaction history after a failed/timed-out submission; it only ever shows a generic error
 * and mints a brand-new client-side idempotency key for the next attempt.
 *
 * What this suite DOES prove, with real concurrent HTTP requests against real PostgreSQL, is
 * the actual identity/idempotency architecture the backend relies on instead of heuristic
 * matching (PART 5/7 of the audit):
 *
 *   1. Two logically DISTINCT ₦5,000 transfers to the same recipient (the exact scenario the
 *      original UNK-03 report describes) are never conflated — each gets its own Idempotency-Key,
 *      its own transfer id, and both post as two separate, correctly-ordered ledger effects.
 *      There is no "pick whichever recent transfer looks similar" behaviour anywhere server-side.
 *   2. The EXACT SAME logical request (same Idempotency-Key, same body), fired twice
 *      concurrently — the real race a client timeout-then-retry could trigger — produces
 *      exactly one financial effect: one transfer row, one ledger journal, one debit. The
 *      backend's own unique-constraint-violation recovery path (TransferService#createTransfer,
 *      the `uq_transfers_idempotency_key` catch block) is what is being exercised here, not a
 *      mock.
 *   3. Reusing an Idempotency-Key with a materially different request body (different amount)
 *      is rejected with a deterministic 409, never silently accepted or silently merged into
 *      the prior transfer.
 */
describe('V1-W2W-RECOVERY-SECURITY-AUDIT-01 — backend transfer identity & idempotency (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  function encodePbkdf2(password: string, saltStr: string): string {
    const salt = Buffer.from(saltStr);
    const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
    return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('w2wrecoveryaudit');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => dataSource.destroy().catch(() => undefined));
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function createCustomerWithPin(label: string, displayName: string): Promise<{ customerId: string; token: string }> {
    const reference = `cust-w2wra-${label}-${randomUUID()}`;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, displayName]);
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$3,true)`,
      [customerId, `0${canonical10.slice(1)}`, canonical10],
    );
    const password = 'w2wra-password-1!';
    const hash = encodePbkdf2(password, `w2wra-salt-${label}`);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password })
      .expect(200);
    const token = login.body.accessToken as string;
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '1234' })
      .expect(200);
    return { customerId, token };
  }

  async function fundWallet(walletId: string, ledgerAccountId: string, amountMinor: string): Promise<void> {
    const { LedgerService } = await import('../src/ledger/ledger.service');
    const ls = app.get(LedgerService);
    const plat = await ls.createAccount({
      code: `W2WRA_PLAT_${randomUUID().slice(0, 8)}`,
      name: 'W2W Recovery Audit Platform',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS' as any,
    });
    await ls.postJournal({
      idempotencyKey: `w2wra-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS' as any,
      reference: `w2wra-fund-ref-${randomUUID()}`,
      lines: [
        { accountId: plat.id, direction: 'DEBIT' as any, amountMinor },
        { accountId: ledgerAccountId, direction: 'CREDIT' as any, amountMinor },
      ],
    });
  }

  it('1. Two genuinely distinct ₦5,000 transfers to the same recipient are NEVER conflated — both post as separate, correctly-identified transfers (reproduces the literal UNK-03 scenario at the backend)', async () => {
    const { WalletService } = await import('../src/wallet/wallet.service');
    const ws = app.get(WalletService);

    const customerA = await createCustomerWithPin('a', 'Customer A');
    const amina = await createCustomerWithPin('amina', 'Amina');

    const walletA = await ws.createWallet({ customerId: customerA.customerId, currency: 'NGN', idempotencyKey: `w2wra-wa-${customerA.customerId}` });
    const walletAmina = await ws.createWallet({ customerId: amina.customerId, currency: 'NGN', idempotencyKey: `w2wra-wb-${amina.customerId}` });

    // Customer A has enough for both ₦5,000 transfers (₦15,000 funded).
    await fundWallet(walletA.id, walletA.ledgerAccountId, '1500000');

    // Transfer #1: ₦5,000 to Amina — succeeds.
    const idem1 = `w2wra-transfer-1-${randomUUID()}`;
    const transfer1 = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${customerA.token}`)
      .set('Idempotency-Key', idem1)
      .send({
        sourceWalletId: walletA.id,
        destinationWalletId: walletAmina.id,
        amountMinor: '500000',
        currency: 'NGN',
        narration: 'Lunch money',
        pin: '1234',
      })
      .expect(201);
    expect(transfer1.body.id).toBeDefined();

    // Transfer #2: a LATER, DISTINCT logical ₦5,000 transfer to Amina — its own Idempotency-Key,
    // exactly as a correctly-implemented client would mint for a new user-initiated send action.
    const idem2 = `w2wra-transfer-2-${randomUUID()}`;
    const transfer2 = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${customerA.token}`)
      .set('Idempotency-Key', idem2)
      .send({
        sourceWalletId: walletA.id,
        destinationWalletId: walletAmina.id,
        amountMinor: '500000',
        currency: 'NGN',
        narration: 'Lunch money',
        pin: '1234',
      })
      .expect(201);
    expect(transfer2.body.id).toBeDefined();

    // PROOF: the two transfers are distinct financial facts, not one conflated with the other.
    expect(transfer2.body.id).not.toBe(transfer1.body.id);

    // PROOF: both debits actually happened — the backend never silently treated the second
    // request as "the same as the first" and skipped posting it.
    const balanceA = await ws.getWalletBalance(walletA.id);
    const balanceAmina = await ws.getWalletBalance(walletAmina.id);
    expect(balanceA.balanceMinor).toBe('500000'); // 1,500,000 - 500,000 - 500,000
    expect(balanceAmina.balanceMinor).toBe('1000000'); // received both ₦5,000 transfers

    // PROOF: transaction history correctly reports TWO separate WALLET_TRANSFER rows for
    // Customer A, each with its own id, not one row duplicated or one transfer missing.
    const history = await request(app.getHttpServer())
      .get('/api/v1/customers/me/transactions')
      .set('Authorization', `Bearer ${customerA.token}`)
      .expect(200);
    const transferRows = (history.body.items as any[]).filter((item) => item.type === 'WALLET_TRANSFER');
    expect(transferRows).toHaveLength(2);
    const ids = transferRows.map((row) => row.id).sort();
    expect(ids).toEqual([transfer1.body.id, transfer2.body.id].sort());
  });

  it('2. The exact same logical request (same Idempotency-Key, same body) fired TWICE CONCURRENTLY produces exactly one financial effect — the real client-timeout-then-retry race, proven against real PostgreSQL', async () => {
    const { WalletService } = await import('../src/wallet/wallet.service');
    const ws = app.get(WalletService);

    const customerA = await createCustomerWithPin('conc-a', 'Concurrent Customer A');
    const customerB = await createCustomerWithPin('conc-b', 'Concurrent Customer B');

    const walletA = await ws.createWallet({ customerId: customerA.customerId, currency: 'NGN', idempotencyKey: `w2wra-conc-wa-${customerA.customerId}` });
    const walletB = await ws.createWallet({ customerId: customerB.customerId, currency: 'NGN', idempotencyKey: `w2wra-conc-wb-${customerB.customerId}` });

    await fundWallet(walletA.id, walletA.ledgerAccountId, '500000');

    const idem = `w2wra-concurrent-${randomUUID()}`;
    const body = {
      sourceWalletId: walletA.id,
      destinationWalletId: walletB.id,
      amountMinor: '500000',
      currency: 'NGN',
      narration: 'Single logical transfer, retried after a timeout',
      pin: '1234',
    };

    // Fire the identical request twice, truly concurrently — this is exactly what a mobile
    // client retry-after-ambiguous-timeout looks like at the HTTP layer when it (correctly)
    // reuses the same Idempotency-Key for the same logical operation.
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/customers/me/transfers')
        .set('Authorization', `Bearer ${customerA.token}`)
        .set('Idempotency-Key', idem)
        .send(body),
      request(app.getHttpServer())
        .post('/api/v1/customers/me/transfers')
        .set('Authorization', `Bearer ${customerA.token}`)
        .set('Idempotency-Key', idem)
        .send(body),
    ]);

    const responses = [r1, r2];
    for (const r of responses) {
      expect([201, 409]).toContain(r.status);
    }
    const successes = responses.filter((r) => r.status === 201);
    // At least one must succeed (the operation is legitimate and fully funded).
    expect(successes.length).toBeGreaterThanOrEqual(1);
    // Every successful response must report the SAME transfer id — never two different ids for
    // what is, by Idempotency-Key, declared to be one logical operation.
    const distinctIds = new Set(successes.map((r) => r.body.id));
    expect(distinctIds.size).toBe(1);

    // PROOF (the actual financial-safety question): exactly ONE debit happened, not two.
    const balanceA = await ws.getWalletBalance(walletA.id);
    const balanceB = await ws.getWalletBalance(walletB.id);
    expect(balanceA.balanceMinor).toBe('0');
    expect(balanceB.balanceMinor).toBe('500000');

    // PROOF: exactly one transfer row and one ledger journal exist for this idempotency key —
    // no duplicate row was created by the race, and no duplicate journal was posted.
    const transferRows: Array<{ id: string; journal_id: string | null }> = await dataSource.query(
      `SELECT id, journal_id FROM transfers WHERE idempotency_key = $1`,
      [idem],
    );
    expect(transferRows).toHaveLength(1);
    expect(transferRows[0]!.journal_id).toBeTruthy();

    const journalRows: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text AS count FROM ledger_journals WHERE id = $1`,
      [transferRows[0]!.journal_id],
    );
    expect(journalRows[0]!.count).toBe('1');

    const historyA = await request(app.getHttpServer())
      .get('/api/v1/customers/me/transactions')
      .set('Authorization', `Bearer ${customerA.token}`)
      .expect(200);
    const transferHistoryRows = (historyA.body.items as any[]).filter((item) => item.type === 'WALLET_TRANSFER');
    expect(transferHistoryRows).toHaveLength(1);
  });

  it('3. Reusing an Idempotency-Key for a materially DIFFERENT request (different amount) is deterministically rejected, never silently merged with the prior transfer', async () => {
    const { WalletService } = await import('../src/wallet/wallet.service');
    const ws = app.get(WalletService);

    const customerA = await createCustomerWithPin('mismatch-a', 'Mismatch Customer A');
    const customerB = await createCustomerWithPin('mismatch-b', 'Mismatch Customer B');

    const walletA = await ws.createWallet({ customerId: customerA.customerId, currency: 'NGN', idempotencyKey: `w2wra-mismatch-wa-${customerA.customerId}` });
    const walletB = await ws.createWallet({ customerId: customerB.customerId, currency: 'NGN', idempotencyKey: `w2wra-mismatch-wb-${customerB.customerId}` });

    await fundWallet(walletA.id, walletA.ledgerAccountId, '1000000');

    const idem = `w2wra-mismatch-${randomUUID()}`;
    const first = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${customerA.token}`)
      .set('Idempotency-Key', idem)
      .send({
        sourceWalletId: walletA.id,
        destinationWalletId: walletB.id,
        amountMinor: '500000',
        currency: 'NGN',
        pin: '1234',
      })
      .expect(201);

    // Same key, different amount: must be rejected with 409, not silently accepted as a second
    // transfer and not silently treated as a replay of the first (which would hide the amount
    // mismatch from the caller).
    const second = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${customerA.token}`)
      .set('Idempotency-Key', idem)
      .send({
        sourceWalletId: walletA.id,
        destinationWalletId: walletB.id,
        amountMinor: '600000',
        currency: 'NGN',
        pin: '1234',
      })
      .expect(409);
    expect(String(second.body.message || '')).toMatch(/idempotency key was already used/i);

    // PROOF: only the first transfer's amount was ever debited.
    const balanceA = await ws.getWalletBalance(walletA.id);
    expect(balanceA.balanceMinor).toBe('500000'); // 1,000,000 - 500,000 only
    expect(first.body.id).toBeDefined();
  });
});
