/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { createHash, pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'v1c08-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/**
 * V1-CUSTOMER-08 — GET /customers/me/limits (customer-safe projection of the
 * authoritative limit-catalog system) + account-status authoritativeness checks.
 *
 * These tests exercise the REAL LimitProfileResolverService / limit_rules / limit_usages
 * tables and the REAL LimitEnforcementService (the exact enforcement path used by
 * transfer.service.ts and the agent cash-in/cash-out/C2C/funding flows), never a
 * parallel/mocked calculation — so a passing test is direct evidence that the
 * customer-facing projection matches backend-authoritative state.
 */
describe('V1-CUSTOMER-08 Customer Limits & Account Status (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1c08limits');
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

  async function createCustomerWithCredential(
    opts: { custStatus?: string; kycLevel?: string; kycStatus?: string } = {},
  ): Promise<{ customerId: string; token: string }> {
    const reference = `cust-v1c08-${randomUUID()}`;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL',$2,$3,$4) RETURNING id`,
      [reference, opts.custStatus ?? 'ACTIVE', opts.kycLevel ?? 'LEVEL_1', opts.kycStatus ?? 'APPROVED'],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, 'V1C08 Customer']);
    const password = 'correct-password-v1c08';
    const hash = encodePbkdf2(password);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    if (opts.custStatus && opts.custStatus !== 'ACTIVE') {
      // Cannot log in while not ACTIVE — the test that needs a token for a non-ACTIVE
      // customer logs in first, then flips status afterwards (see suspension test below).
      return { customerId, token: '' };
    }
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(200);
    return { customerId, token: login.body.accessToken as string };
  }

  async function createGlobalProfileWithRules(
    rules: Array<{ product: string; direction?: string | null; dimension: string; limitValueMinor?: string | null; limitValueCount?: number | null }>,
  ): Promise<string> {
    const code = `PROF_${randomUUID().slice(0, 8).toUpperCase().replace(/-/g, '_')}`;
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ($1,$2,'UNIVERSAL','ACTIVE',true,'CONFIGURED','test')`,
      [code, `Profile ${code}`],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, is_active, created_by) VALUES ($1,$2,'GLOBAL',NULL,NULL,0,NOW(),true,'test')`,
      [randomUUID(), code],
    );
    for (const r of rules) {
      await dataSource.query(
        `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, is_active, created_by)
         VALUES ($1,$2,$3,$4,NULL,'NGN',$5,$6,$7,NOW(),true,'test')`,
        [randomUUID(), code, r.product, r.direction ?? null, r.dimension, r.limitValueMinor ?? null, r.limitValueCount ?? null],
      );
    }
    return code;
  }

  // ──────────────────────────────────────────────
  // Part H(1) — customer can retrieve applicable limit info
  // ──────────────────────────────────────────────
  it('1. Unauthenticated request is rejected (401) — backend remains authoritative, not client-trusted', async () => {
    await request(app.getHttpServer()).get('/api/v1/customers/me/limits').expect(401);
  });

  it('2. No limit profile/assignment configured — returns all known customer products as unconfigured, never fabricates a limit', async () => {
    const { token } = await createCustomerWithCredential();
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/limits').set('Authorization', `Bearer ${token}`).expect(200);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products.length).toBe(5);
    for (const p of res.body.products) {
      expect(p.configured).toBe(false);
      expect(p.windows).toEqual([]);
      expect(p.perTransactionMinMinor).toBeNull();
      expect(p.perTransactionMaxMinor).toBeNull();
    }
    const names = res.body.products.map((p: any) => p.product).sort();
    expect(names).toEqual(['CASH_TO_CASH', 'CASH_TO_WALLET', 'CUSTOMER_FUNDING', 'WALLET_TO_CASH', 'WALLET_TRANSFER'].sort());
  });

  it('3. Response never leaks internal policy identifiers (profile code, assignment id, rule id, channel, created_by)', async () => {
    const { token } = await createCustomerWithCredential();
    await createGlobalProfileWithRules([
      { product: 'WALLET_TRANSFER', direction: 'OUTGOING', dimension: 'MAX_AMOUNT_PER_TX', limitValueMinor: '500000' },
      { product: 'WALLET_TRANSFER', direction: 'OUTGOING', dimension: 'DAILY_AMOUNT', limitValueMinor: '1000000' },
    ]);
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/limits').set('Authorization', `Bearer ${token}`).expect(200);
    const serial = JSON.stringify(res.body).toLowerCase();
    expect(serial).not.toContain('prof_'); // limitProfileCode format used in this test
    expect(serial).not.toContain('assignmentid');
    expect(serial).not.toContain('ruleid');
    expect(serial).not.toContain('createdby');
    expect(serial).not.toContain('priority');
    expect(serial).not.toContain('ledgeraccount');
  });

  // ──────────────────────────────────────────────
  // Part H(3) — displayed limit matches authoritative backend policy
  // ──────────────────────────────────────────────
  it('4. Configured per-transaction MAX and windowed DAILY_AMOUNT match exactly what was configured', async () => {
    const { token } = await createCustomerWithCredential();
    await createGlobalProfileWithRules([
      { product: 'WALLET_TRANSFER', direction: 'OUTGOING', dimension: 'MAX_AMOUNT_PER_TX', limitValueMinor: '500000' },
      { product: 'WALLET_TRANSFER', direction: 'OUTGOING', dimension: 'MIN_AMOUNT_PER_TX', limitValueMinor: '1000' },
      { product: 'WALLET_TRANSFER', direction: 'OUTGOING', dimension: 'DAILY_AMOUNT', limitValueMinor: '1000000' },
      { product: 'WALLET_TRANSFER', direction: 'OUTGOING', dimension: 'DAILY_COUNT', limitValueCount: 10 },
    ]);
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/limits').set('Authorization', `Bearer ${token}`).expect(200);
    const wt = res.body.products.find((p: any) => p.product === 'WALLET_TRANSFER');
    expect(wt.configured).toBe(true);
    expect(wt.perTransactionMaxMinor).toBe('500000');
    expect(wt.perTransactionMinMinor).toBe('1000');
    const dailyAmount = wt.windows.find((w: any) => w.dimension === 'DAILY_AMOUNT');
    expect(dailyAmount.limitMinor).toBe('1000000');
    expect(dailyAmount.usedMinor).toBe('0');
    expect(dailyAmount.remainingMinor).toBe('1000000');
    expect(dailyAmount.period).toBe('DAILY');
    expect(new Date(dailyAmount.windowResetsAt).getTime()).toBeGreaterThan(Date.now());
    const dailyCount = wt.windows.find((w: any) => w.dimension === 'DAILY_COUNT');
    expect(dailyCount.limitCount).toBe(10);
    expect(dailyCount.remainingCount).toBe(10);
    // Other products remain unconfigured — buckets are isolated (Part G)
    const cashIn = res.body.products.find((p: any) => p.product === 'CASH_TO_WALLET');
    expect(cashIn.configured).toBe(false);
  });

  // ──────────────────────────────────────────────
  // Part H(4) — remaining capacity calculated consistently with the REAL enforcement engine
  // ──────────────────────────────────────────────
  it('5. After a real enforceWithManager reservation + commit, used/remaining reflect the committed amount exactly (same engine as transfer.service.ts)', async () => {
    const { customerId, token } = await createCustomerWithCredential();
    await createGlobalProfileWithRules([{ product: 'WALLET_TRANSFER', direction: 'OUTGOING', dimension: 'DAILY_AMOUNT', limitValueMinor: '1000000' }]);

    const enforcement = app.get(LimitEnforcementService);
    const idempotencyKey = `v1c08-${randomUUID()}`;
    await dataSource.transaction(async (manager) => {
      const result = await enforcement.enforceWithManager(manager, {
        principalType: 'CUSTOMER',
        principalId: customerId,
        product: 'WALLET_TRANSFER',
        currency: 'NGN',
        direction: 'OUTGOING',
        channel: null,
        amountMinor: '300000',
        idempotencyKey,
        requestHash: createHash('sha256').update('v1c08-test-5').digest('hex'),
      });
      expect(result.allowed).toBe(true);
      await enforcement.commitReservationsWithManager(manager, idempotencyKey);
    });

    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/limits').set('Authorization', `Bearer ${token}`).expect(200);
    const wt = res.body.products.find((p: any) => p.product === 'WALLET_TRANSFER');
    const dailyAmount = wt.windows.find((w: any) => w.dimension === 'DAILY_AMOUNT');
    expect(dailyAmount.usedMinor).toBe('300000');
    expect(dailyAmount.remainingMinor).toBe('700000');
  });

  it('5b. A RESERVED (not yet committed) amount still reduces displayed remaining (pending holds capacity) — matches enforcement semantics', async () => {
    const { customerId, token } = await createCustomerWithCredential();
    await createGlobalProfileWithRules([{ product: 'WALLET_TRANSFER', direction: 'OUTGOING', dimension: 'DAILY_AMOUNT', limitValueMinor: '1000000' }]);
    const enforcement = app.get(LimitEnforcementService);
    const idempotencyKey = `v1c08-${randomUUID()}`;
    await dataSource.transaction(async (manager) => {
      const result = await enforcement.enforceWithManager(manager, {
        principalType: 'CUSTOMER',
        principalId: customerId,
        product: 'WALLET_TRANSFER',
        currency: 'NGN',
        direction: 'OUTGOING',
        channel: null,
        amountMinor: '200000',
        idempotencyKey,
        requestHash: createHash('sha256').update('v1c08-test-5b').digest('hex'),
      });
      expect(result.allowed).toBe(true);
      // Deliberately do NOT commit — simulates an in-flight financial operation.
    });
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/limits').set('Authorization', `Bearer ${token}`).expect(200);
    const wt = res.body.products.find((p: any) => p.product === 'WALLET_TRANSFER');
    const dailyAmount = wt.windows.find((w: any) => w.dimension === 'DAILY_AMOUNT');
    expect(dailyAmount.usedMinor).toBe('0');
    expect(dailyAmount.remainingMinor).toBe('800000'); // 1,000,000 - 0 used - 200,000 reserved
  });

  // ──────────────────────────────────────────────
  // Part H(2)/Part I — customer cannot retrieve another customer's limits (no :id param; SELF-only)
  // ──────────────────────────────────────────────
  it('6. Each customer sees only their own CUSTOMER-scoped assignment, never another customer\'s', async () => {
    const a = await createCustomerWithCredential();
    const b = await createCustomerWithCredential();
    // Customer-specific profile for A only, stricter than any default.
    const code = `PROF_${randomUUID().slice(0, 8).toUpperCase().replace(/-/g, '_')}`;
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ($1,$2,'CUSTOMER','ACTIVE',true,'CONFIGURED','test')`,
      [code, `Profile ${code}`],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, is_active, created_by) VALUES ($1,$2,'CUSTOMER',$3,NULL,10,NOW(),true,'test')`,
      [randomUUID(), code, a.customerId],
    );
    await dataSource.query(
      `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, effective_from, is_active, created_by)
       VALUES ($1,$2,'WALLET_TRANSFER','OUTGOING',NULL,'NGN','MAX_AMOUNT_PER_TX','50000',NOW(),true,'test')`,
      [randomUUID(), code],
    );

    const resA = await request(app.getHttpServer()).get('/api/v1/customers/me/limits').set('Authorization', `Bearer ${a.token}`).expect(200);
    const resB = await request(app.getHttpServer()).get('/api/v1/customers/me/limits').set('Authorization', `Bearer ${b.token}`).expect(200);

    const wtA = resA.body.products.find((p: any) => p.product === 'WALLET_TRANSFER');
    const wtB = resB.body.products.find((p: any) => p.product === 'WALLET_TRANSFER');
    expect(wtA.configured).toBe(true);
    expect(wtA.perTransactionMaxMinor).toBe('50000');
    expect(wtB.configured).toBe(false); // B has no assignment and no GLOBAL default — unaffected by A's profile
  });

  // ──────────────────────────────────────────────
  // Part C / Part H(5)(6) — account status is backend-authoritative, suspended never shown as active
  // ──────────────────────────────────────────────
  it('7. GET /customers/me/status reflects the true backend status (ACTIVE)', async () => {
    const { customerId, token } = await createCustomerWithCredential();
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/status').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.id).toBe(customerId);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('8. A SUSPENDED customer loses session access immediately — never served a stale "ACTIVE" view (session re-checks live status on every request)', async () => {
    const { customerId, token } = await createCustomerWithCredential();
    // Confirm the session works while ACTIVE.
    await request(app.getHttpServer()).get('/api/v1/customers/me/status').set('Authorization', `Bearer ${token}`).expect(200);
    // Flip status directly at the authoritative source (as an admin lifecycle transition would).
    await dataSource.query(`UPDATE customers SET status = 'SUSPENDED' WHERE id = $1`, [customerId]);
    // The same, still cryptographically valid bearer token must now be rejected —
    // proves status is re-checked live, not cached/trusted from issuance time.
    await request(app.getHttpServer()).get('/api/v1/customers/me/status').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/customers/me/limits').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/customers/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('9. Login for a SUSPENDED customer fails with a generic error (no account-status leakage to an unauthenticated caller)', async () => {
    const reference = `cust-v1c08-susp-${randomUUID()}`;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','SUSPENDED','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    const password = 'correct-password-v1c08';
    const hash = encodePbkdf2(password);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    const res = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(401);
    expect(String(res.body.message || '').toLowerCase()).toContain('invalid credentials');
    expect(String(res.body.message || '').toLowerCase()).not.toContain('suspend');
  });
});
