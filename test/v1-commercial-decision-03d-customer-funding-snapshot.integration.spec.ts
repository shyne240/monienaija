/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * V1-COMMERCIAL-DECISION-03D — CUSTOMER_FUNDING commercial snapshot wiring (real PostgreSQL).
 *
 * The snapshot belongs to the CHECKER APPROVAL execution — the actual financial/commercial
 * decision — recorded inside the existing SERIALIZABLE approve transaction of
 * CustomerFundingService. Request creation and rejection never produce a snapshot;
 * maker/checker separation is exercised on every path.
 *
 * Verified: success atomicity, snapshot content, approve convergence (replay), maker/checker
 * separation, creation idempotency, rejection path, forced rollback, limit rejection,
 * synthetic TEST-ONLY fee rule captured without charging, immutability, exact boundary.
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { CustomerFundingService } from '../src/customer-funding/customer-funding.service';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('V1-COMMERCIAL-DECISION-03D CUSTOMER_FUNDING snapshot wiring (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let fundingService: CustomerFundingService;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let feeRuleRegistry: FeeRuleRegistryService;
  let settlementAccountId: string;

  const supportMaker: any = {
    type: 'SUPPORT',
    principalId: `support-maker-${randomUUID().slice(0, 6)}`,
    roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE',
  };
  const operatorChecker: any = {
    type: 'OPERATOR',
    principalId: `operator-checker-${randomUUID().slice(0, 6)}`,
    roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE',
  };
  const supportChecker: any = {
    type: 'SUPPORT',
    principalId: `support-checker-${randomUUID().slice(0, 6)}`,
    roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE',
  };

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
        roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE',
      } as any;
    },
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-comm-decision-03d');
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
    fundingService = moduleRef.get(CustomerFundingService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
    feeRuleRegistry = moduleRef.get(FeeRuleRegistryService);
    await moduleRef.get(ProductCatalogSeedService).seedIfEmpty();

    // Authoritative settlement control account (migration-seeded; provision defensively like v1-001)
    const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    if (rows[0]) {
      settlementAccountId = rows[0].id;
    } else {
      await dataSource.query(`
        INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
        VALUES ('00000000-0000-4000-8000-000000000201','PAYMENT-SETTLEMENT_ASSET-NGN','Payment settlement asset NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE)
        ON CONFLICT (code) DO NOTHING
      `);
      const again: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
      settlementAccountId = again[0].id;
    }
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60_000);

  // ── harness (synthetic test data only; mirrors v1-001 conventions) ──

  async function createCustomerWithWallet() {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-03d-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0].id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer 03D',true)`, [customerId]);
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `cust-wallet-${customerId}-${randomUUID()}`,
    });
    return { customerId, wallet };
  }

  async function createPendingRequest(customerId: string, amountMinor: string, idem?: string) {
    return fundingService.createRequest({
      customerId,
      amountMinor,
      currency: 'NGN',
      idempotencyKey: idem ?? `idem-03d-${randomUUID()}`,
      principal: supportMaker,
    });
  }

  async function seedLimitProfile(code: string, customerId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ($1,$2,'CUSTOMER','ACTIVE',true,'CONFIGURED','test')`,
      [code, `Profile ${code}`],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,'CUSTOMER',$3,NULL,0,$4,NULL,true,'test')`,
      [randomUUID(), code, customerId, new Date(Date.now() - 86400000).toISOString()],
    );
  }

  async function seedLimitRule(profileCode: string, dimension: string, limitMinor: string): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,'CUSTOMER_FUNDING',NULL,NULL,'NGN',$3,$4,NULL,$5,NULL,true,'test')`,
      [id, profileCode, dimension, limitMinor, new Date(Date.now() - 86400000).toISOString()],
    );
    return id;
  }

  async function snapshotsFor(key: { journalId?: string; idempotencyKey?: string; product?: string; principalId?: string }): Promise<any[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (key.journalId) { params.push(key.journalId); clauses.push(`journal_id = $${params.length}`); }
    if (key.idempotencyKey) { params.push(key.idempotencyKey); clauses.push(`idempotency_key = $${params.length}`); }
    if (key.product) { params.push(key.product); clauses.push(`product = $${params.length}`); }
    if (key.principalId) { params.push(key.principalId); clauses.push(`principal_id = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return dataSource.query(`SELECT * FROM commercial_decision_snapshots ${where}`, params);
  }

  // ── 1. success atomicity + snapshot content ──

  it('01. checker approval creates exactly one FINAL snapshot with authoritative limit evidence; funding credit unchanged', async () => {
    const { customerId, wallet } = await createCustomerWithWallet();
    const profile = `P03D_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, customerId);
    const dailyRule = await seedLimitRule(profile, 'DAILY_AMOUNT', '5000000');

    const created = await createPendingRequest(customerId, '30000');
    expect(created.status).toBe('PENDING');
    expect(created.journalId).toBeNull();
    // request creation alone never snapshots
    expect(await snapshotsFor({ product: 'CUSTOMER_FUNDING', principalId: customerId })).toHaveLength(0);

    const approved = await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    expect(approved.status).toBe('APPROVED');
    expect(approved.journalId).toBeDefined();

    // financial behavior UNCHANGED: DEBIT settlement asset, CREDIT customer wallet, request APPROVED
    const lines: Array<any> = await dataSource.query(
      `SELECT direction, amount_minor::text AS amount_minor, ledger_account_id FROM ledger_lines WHERE journal_id=$1 ORDER BY direction`,
      [approved.journalId],
    );
    expect(lines).toHaveLength(2);
    const debit = lines.find((l) => l.direction === 'DEBIT');
    const credit = lines.find((l) => l.direction === 'CREDIT');
    expect(debit.amount_minor).toBe('30000');
    expect(debit.ledger_account_id).toBe(settlementAccountId);
    expect(credit.amount_minor).toBe('30000');
    expect(credit.ledger_account_id).toBe(wallet.ledgerAccountId);
    expect((await ledgerService.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('30000');
    const reqRows: Array<any> = await dataSource.query(`SELECT status, journal_id, checker_id FROM customer_funding_requests WHERE id=$1`, [created.id]);
    expect(reqRows[0].status).toBe('APPROVED');
    expect(reqRows[0].journal_id).toBe(approved.journalId);
    expect(reqRows[0].checker_id).toBe(operatorChecker.principalId);

    // exactly one snapshot describing the APPROVAL financial execution
    const snapshots = await snapshotsFor({ journalId: approved.journalId });
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0];
    expect(snap.product).toBe('CUSTOMER_FUNDING'); // canonical product identity
    expect(snap.transaction_reference).toBe(approved.journalId);
    expect(snap.journal_id).toBe(approved.journalId);
    expect(snap.idempotency_key).toBe(`customer-funding:${created.id}`);
    expect(snap.principal_type).toBe('CUSTOMER'); // funded customer = economic principal
    expect(snap.principal_id).toBe(customerId);
    expect(snap.direction).toBe('INCOMING'); // authoritative limit direction
    expect(snap.currency).toBe('NGN');
    expect(snap.principal_amount_minor.toString()).toBe('30000');
    expect(snap.decision_status).toBe('FINAL');
    expect(snap.created_by).toBe('customer-funding');
    expect(snap.revenue_decision).toBeNull();
    expect(snap.configuration_version).toBeNull();
    expect(snap.fee_decision.status).toBe('NOT_CONFIGURED');
    expect(snap.fee_decision.feeMinor).toBe('0');
    expect(snap.fee_decision.totalMinor).toBe('30000');
    expect(snap.fee_decision.ruleRefs).toEqual([]);
    expect(snap.fee_decision.fundingRequestId).toBe(created.id);
    expect(snap.fee_decision.makerId).toBe(supportMaker.principalId);
    expect(snap.fee_decision.checkerId).toBe(operatorChecker.principalId);
    expect(snap.commission_decision).toEqual({ status: 'NONE', allocations: [], ruleRefs: [] });
    expect(snap.reward_decision).toEqual({ status: 'NONE', grants: [], ruleRefs: [] });
    expect(snap.limit_decision.status).toBe('APPROVED');
    expect(snap.limit_decision.profileCode).toBe(profile);
    expect(snap.limit_decision.ruleRefs.map((r: any) => r.ruleId)).toEqual([dailyRule]);
    const reservations: Array<any> = await dataSource.query(`SELECT id, limit_usage_id FROM limit_reservations WHERE idempotency_key=$1 ORDER BY id`, [`customer-funding-approve:${created.id}`]);
    expect(reservations.length).toBe(1);
    expect(snap.limit_decision.reservationIds).toEqual(reservations.map((r) => r.id));
    expect(snap.limit_decision.usageIds).toEqual(reservations.map((r) => r.limit_usage_id));

    // workforce diagnostic read API verifies it (no duplicate APIs created)
    const list = await request(app.getHttpServer())
      .get('/api/v1/internal/commercial-decision-snapshots?product=CUSTOMER_FUNDING')
      .set('Authorization', 'Bearer workforce-operator')
      .expect(200);
    const items = Array.isArray(list.body) ? list.body : list.body.data ?? [];
    expect(items.some((s: any) => (s.transactionReference ?? s.transaction_reference) === approved.journalId)).toBe(true);
  });

  // ── 2. zero-fee financial proof ──

  it('02. principal-only funding credit: exactly two journal lines, no fee/revenue accounts created', async () => {
    const { customerId, wallet } = await createCustomerWithWallet();
    const created = await createPendingRequest(customerId, '22000');
    const accountsBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_accounts`);

    const approved = await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    expect(approved.status).toBe('APPROVED');

    const lines: Array<any> = await dataSource.query(`SELECT direction, amount_minor::text AS amount_minor FROM ledger_lines WHERE journal_id=$1`, [approved.journalId]);
    expect(lines).toHaveLength(2); // principal movement only — no fee/revenue/commission/reward lines
    for (const l of lines) expect(l.amount_minor).toBe('22000');
    const accountsAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_accounts`);
    expect(accountsAfter[0].cnt).toBe(accountsBefore[0].cnt);
    expect((await ledgerService.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('22000');
  });

  // ── 3. approve convergence (replay) ──

  it('03. approving an already-APPROVED request converges: 409, snapshot count stays ONE, no double credit', async () => {
    const { customerId, wallet } = await createCustomerWithWallet();
    const created = await createPendingRequest(customerId, '15000');
    const approved = await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    expect(approved.status).toBe('APPROVED');
    const journalsAfterFirst: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);

    await expect(fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker })).rejects.toMatchObject({ status: 409 });

    expect(await snapshotsFor({ journalId: approved.journalId })).toHaveLength(1); // NOT duplicated
    const journalsAfterSecond: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    expect(journalsAfterSecond[0].cnt).toBe(journalsAfterFirst[0].cnt);
    expect((await ledgerService.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('15000'); // credited once
  });

  // ── 4. maker/checker separation ──

  it('04. maker cannot approve own request; SUPPORT cannot check — no snapshot, request stays PENDING', async () => {
    const { customerId } = await createCustomerWithWallet();
    const created = await createPendingRequest(customerId, '9000');

    await expect(fundingService.approve({ fundingRequestId: created.id, principal: supportMaker })).rejects.toMatchObject({ status: 403 });
    await expect(fundingService.approve({ fundingRequestId: created.id, principal: supportChecker })).rejects.toMatchObject({ status: 403 });

    expect(await snapshotsFor({ idempotencyKey: `customer-funding:${created.id}` })).toHaveLength(0);
    const reqRows: Array<any> = await dataSource.query(`SELECT status, journal_id FROM customer_funding_requests WHERE id=$1`, [created.id]);
    expect(reqRows[0].status).toBe('PENDING');
    expect(reqRows[0].journal_id).toBeNull();
    // nothing posted by the denied reviews
    expect((await dataSource.query(`SELECT id FROM ledger_journals WHERE idempotency_key=$1`, [`customer-funding:${created.id}`])).length).toBe(0);
  });

  // ── 5. creation idempotency ──

  it('05. creation idempotency preserved: identical payload converges; different payload conflicts; never snapshots', async () => {
    const { customerId } = await createCustomerWithWallet();
    const idem = `idem-03d-05-${randomUUID()}`;
    const first = await createPendingRequest(customerId, '7000', idem);
    const replayed = await createPendingRequest(customerId, '7000', idem);
    expect(replayed.id).toBe(first.id); // converged on the same request
    expect(replayed.status).toBe('PENDING');
    await expect(createPendingRequest(customerId, '7001', idem)).rejects.toMatchObject({ status: 409 });
    // creation never snapshots (this customer is fresh; no approval happened)
    expect(await snapshotsFor({ product: 'CUSTOMER_FUNDING', principalId: customerId })).toHaveLength(0);
  });

  // ── 6. rejection path ──

  it('06. rejection creates NO commercial snapshot and no financial mutation', async () => {
    const { customerId, wallet } = await createCustomerWithWallet();
    const created = await createPendingRequest(customerId, '12000');
    const rejected = await fundingService.reject({
      fundingRequestId: created.id,
      principal: operatorChecker,
      rejectionReason: 'duplicate request',
    });
    expect(rejected.status).toBe('REJECTED');
    expect(await snapshotsFor({ idempotencyKey: `customer-funding:${created.id}` })).toHaveLength(0);
    expect((await ledgerService.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('0');
    expect((await dataSource.query(`SELECT id FROM ledger_journals WHERE idempotency_key=$1`, [`customer-funding:${created.id}`])).length).toBe(0);
    // rejected request cannot be approved afterwards
    await expect(fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker })).rejects.toMatchObject({ status: 409 });
  });

  // ── 7. rollback atomicity ──

  it('07. forced failure after the snapshot rolls back snapshot + limits + journal + APPROVED state; clean retry then succeeds once', async () => {
    const { customerId, wallet } = await createCustomerWithWallet();
    const profile = `P03D_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, customerId);
    await seedLimitRule(profile, 'DAILY_AMOUNT', '5000000');

    const created = await createPendingRequest(customerId, '25000');
    const journalsBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);

    await expect(
      fundingService.approve({
        fundingRequestId: created.id,
        principal: operatorChecker,
        _simulateFailureAfterJournal: true, // fails AFTER snapshot, BEFORE commit
      }),
    ).rejects.toThrow('Simulated failure after journal');

    // everything rolled back together
    expect(await snapshotsFor({ idempotencyKey: `customer-funding:${created.id}` })).toHaveLength(0); // snapshot gone
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [`customer-funding-approve:${created.id}`])).length).toBe(0);
    expect((await dataSource.query(`SELECT id FROM limit_usages WHERE principal_id=$1 AND product='CUSTOMER_FUNDING'`, [customerId])).length).toBe(0);
    const journalsAfterFail: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    expect(journalsAfterFail[0].cnt).toBe(journalsBefore[0].cnt); // journal gone
    expect((await ledgerService.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('0'); // balance unchanged
    const reqRows: Array<any> = await dataSource.query(`SELECT status, journal_id FROM customer_funding_requests WHERE id=$1`, [created.id]);
    expect(reqRows[0].status).toBe('PENDING'); // funding state rolled back
    expect(reqRows[0].journal_id).toBeNull();

    // clean retry succeeds — no stranded side effects from the rolled-back attempt
    const approved = await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    expect(approved.status).toBe('APPROVED');
    expect(await snapshotsFor({ idempotencyKey: `customer-funding:${created.id}` })).toHaveLength(1); // exactly one
    expect((await ledgerService.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('25000');
  });

  // ── 8. limit rejection ──

  it('08. limit-rejected approval: 422, no snapshot, no stranded reservation, no mutation, request stays PENDING', async () => {
    const { customerId, wallet } = await createCustomerWithWallet();
    const profile = `P03D_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, customerId);
    await seedLimitRule(profile, 'DAILY_AMOUNT', '20000'); // tighter than the requested amount

    const created = await createPendingRequest(customerId, '30000');
    await expect(fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker })).rejects.toMatchObject({ status: 422 });

    expect(await snapshotsFor({ idempotencyKey: `customer-funding:${created.id}` })).toHaveLength(0);
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [`customer-funding-approve:${created.id}`])).length).toBe(0);
    expect((await ledgerService.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('0');
    const reqRows: Array<any> = await dataSource.query(`SELECT status FROM customer_funding_requests WHERE id=$1`, [created.id]);
    expect(reqRows[0].status).toBe('PENDING');
  });

  // ── 9. synthetic fee rule evidence ──

  it('09. TEST-ONLY synthetic fee rule: approval captures ruleId/version/parameters without charging; zero production rules beforehand', async () => {
    const before: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM fee_rules`);
    expect(before[0].cnt).toBe('0'); // NO production fee rules exist

    const rule = await feeRuleRegistry.createRule(
      {
        productCode: 'CUSTOMER_FUNDING',
        currency: 'NGN',
        flatFeeMinor: '300',
        percentageBps: 20,
        minimumFeeMinor: null,
        maximumFeeMinor: null,
        vatBps: null,
        effectiveFrom: new Date(Date.now() - 86400000),
        priority: 0,
        isActive: true,
      },
      'test',
    );

    const { customerId, wallet } = await createCustomerWithWallet();
    const created = await createPendingRequest(customerId, '18000');
    const approved = await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    expect(approved.status).toBe('APPROVED');

    const snapshots = await snapshotsFor({ journalId: approved.journalId });
    expect(snapshots).toHaveLength(1);
    const fee = snapshots[0].fee_decision;
    // V1-COMMERCIAL-IMPLEMENTATION-01 — RESOLVED rule now computes: floor(18000·20/10000)=36 + 300.
    // (CUSTOMER_FUNDING stays FREE in production only because NO rule is ever seeded there;
    // this test proves the engine honors an explicitly configured rule for the product.)
    expect(fee.status).toBe('APPLIED');
    expect(fee.calculationModel).toBe('FLAT_PLUS_PERCENTAGE');
    expect(fee.feeMinor).toBe('336');
    expect(fee.totalMinor).toBe('18336');
    expect(fee.posting).toEqual({
      journalLegsPosted: false,
      reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED',
    }); // accounting boundary — journal below stays principal-only
    expect(fee.ruleRefs).toHaveLength(1);
    expect(fee.ruleRefs[0].ruleId).toBe(rule.id);
    expect(fee.ruleRefs[0].ruleVersion).toBe(1);
    expect(fee.ruleRefs[0].flatFeeMinor).toBe('300');
    expect(fee.ruleRefs[0].percentageBps).toBe(20);

    // money flow UNCHANGED: principal-only journal, exact funding credit
    const lines: Array<any> = await dataSource.query(`SELECT amount_minor::text AS amount_minor FROM ledger_lines WHERE journal_id=$1`, [approved.journalId]);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('18000');
    expect((await ledgerService.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe('18000');
  });

  // ── 10. immutability + wiring boundary ──

  it('10. snapshot immutable + exact wiring boundary (approve boundary wired; agent funding same pattern since 03E)', async () => {
    const { customerId } = await createCustomerWithWallet();
    const created = await createPendingRequest(customerId, '8000');
    const approved = await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    const snapshots = await snapshotsFor({ journalId: approved.journalId });
    expect(snapshots).toHaveLength(1);
    await expect(dataSource.query(`UPDATE commercial_decision_snapshots SET product='X' WHERE id=$1`, [snapshots[0].id])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );
    await expect(dataSource.query(`DELETE FROM commercial_decision_snapshots WHERE id=$1`, [snapshots[0].id])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );

    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const fundingSource = readFileSync(join(__dirname, '../src/customer-funding/customer-funding.service.ts'), 'utf8');
    expect(fundingSource).toContain('resolveWithManager'); // read-only resolution inside the approve tx
    expect(fundingSource).toContain('recordDecisionWithManager'); // snapshot joins the SAME tx
    expect(fundingSource).not.toMatch(/\.recordDecision\(/); // never the second-transaction variant
    expect(fundingSource).not.toContain('feeEngine'); // no FeeEngine participation
    expect(fundingSource).toContain(`productCode = 'CUSTOMER_FUNDING'`); // canonical product identity
    // 03D left AGENT_FUNDING/DEFUNDING unwired; V1-COMMERCIAL-DECISION-03E subsequently wired them
    // with the SAME pattern (justified guard update, not a weakening — see the 03E suite):
    const agentFundingSource = readFileSync(join(__dirname, '../src/agent/agent-funding.service.ts'), 'utf8');
    expect(agentFundingSource).toContain('resolveWithManager');
    expect(agentFundingSource).toContain('recordDecisionWithManager');
    expect(agentFundingSource).not.toMatch(/\.recordDecision\(/);
    expect(agentFundingSource).not.toContain('feeEngine');
    // no duplicate product identities invented
    const products: Array<{ code: string }> = await dataSource.query(`SELECT code FROM products WHERE code LIKE 'CUSTOMER_FUNDING%'`);
    expect(products.map((p) => p.code)).toEqual(['CUSTOMER_FUNDING']);
  });
});
