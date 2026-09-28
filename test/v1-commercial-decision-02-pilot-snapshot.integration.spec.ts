/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * V1-COMMERCIAL-DECISION-02 — PILOT commercial snapshot wiring for WALLET_TRANSFER (real PG).
 *
 * Proves, against real PostgreSQL and the real TransferService:
 *   1. success atomicity: ledger + limit state + commercial snapshot commit together
 *   2. rollback atomicity: a deliberate downstream failure rolls back the snapshot together
 *      with reservations/usages/journal/wallet state
 *   3. idempotent replay never duplicates the snapshot; key+payload mismatch still rejected
 *   4. fee decision = NOT_CONFIGURED (zero production rules) — distinct from an explicit ZERO
 *   5. commission NONE, reward NONE, revenue null; NO fee ledger line, debit/credit = principal
 *   6. limit decision captures the AUTHORITATIVE live enforcement evidence (profile, rule ids,
 *      reservation ids, usage ids) — no second limit evaluation
 *   7. synthetic TEST-ONLY fee rule → snapshot captures exact ruleId + ruleVersion + effective
 *      parameters while the financial transaction stays unchanged (no charging)
 *   8. snapshot immutability and existing W→W behavior preserved
 *
 * NO production fee rules are seeded anywhere: the synthetic rule exists only inside the
 * disposable per-process test database.
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { OutboxService } from '../src/operations/outbox.service';
import { WalletService } from '../src/wallet/wallet.service';
import { TransferService } from '../src/transfer/transfer.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

describe('V1-COMMERCIAL-DECISION-02 Pilot snapshot wiring — WALLET_TRANSFER (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let transferService: TransferService;
  let ledgerService: LedgerService;
  let feeRuleRegistry: FeeRuleRegistryService;

  // Rollback test hook: when armed, the outbox write for a COMPLETED transfer throws AFTER the
  // snapshot has been recorded, forcing a full transaction rollback.
  let failCompletedOutbox = false;

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

  const throwingOutbox = {
    enqueue: async (_manager: unknown, event: { eventType: string }) => {
      if (failCompletedOutbox && event.eventType === 'transfer.completed') {
        throw new Error('simulated downstream failure before commit');
      }
    },
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-comm-decision-02');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .overrideProvider(OutboxService)
      .useValue(throwingOutbox)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await (app.getHttpAdapter().getInstance() as any).ready();
    walletService = app.get(WalletService);
    transferService = app.get(TransferService);
    ledgerService = app.get(LedgerService);
    feeRuleRegistry = app.get(FeeRuleRegistryService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    failCompletedOutbox = false;
    await truncateAllTables(dataSource);
    await app.get(ProductCatalogSeedService).seedIfEmpty();
  });

  // ── harness helpers (synthetic test data only) ──

  async function seedProfile(code: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ($1,$2,'CUSTOMER','ACTIVE',true,'CONFIGURED','test')`,
      [code, `Profile ${code}`],
    );
  }

  async function seedAssignment(profileCode: string, subjectType: string, subjectId: string | null): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,$3,$4,NULL,0,$5,NULL,true,'test')`,
      [randomUUID(), profileCode, subjectType, subjectId, new Date(Date.now() - 86400000).toISOString()],
    );
  }

  async function seedLimitRule(profileCode: string, dimension: string, limitMinor: string | null, limitCount: number | null): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,'WALLET_TRANSFER',NULL,NULL,'NGN',$3,$4,$5,$6,NULL,true,'test')`,
      [id, profileCode, dimension, limitMinor, limitCount, new Date(Date.now() - 86400000).toISOString()],
    );
    return id;
  }

  async function createWallet(customerId: string): Promise<{ id: string; ledgerAccountId: string }> {
    const view = await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `test-${customerId}-${randomUUID()}` });
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [view.id]);
    return { id: view.id, ledgerAccountId: rows[0].ledger_account_id };
  }

  async function fundWallet(walletLedgerAccountId: string, amountMinor: string): Promise<void> {
    const settlementRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    let settlementId = settlementRows[0]?.id;
    if (!settlementId) {
      const any: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE account_type='ASSET' LIMIT 1`);
      settlementId = any[0]?.id;
    }
    if (!settlementId) {
      settlementId = randomUUID();
      await dataSource.query(
        `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active) VALUES ($1,$2,'Settlement','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',true,true)`,
        [settlementId, `SETTLEMENT-${settlementId}`],
      );
    }
    await dataSource.transaction(async (manager) => {
      await ledgerService.postJournalInTransaction(manager, {
        idempotencyKey: `fund-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: `FUND-${walletLedgerAccountId.slice(0, 8)}`,
        lines: [
          { accountId: settlementId, direction: 'DEBIT', amountMinor },
          { accountId: walletLedgerAccountId, direction: 'CREDIT', amountMinor },
        ],
      });
    });
  }

  async function walletBalance(ledgerAccountId: string): Promise<bigint> {
    const rows: Array<{ direction: string; amount_minor: string }> = await dataSource.query(
      `SELECT direction, amount_minor::text AS amount_minor FROM ledger_lines WHERE ledger_account_id=$1`,
      [ledgerAccountId],
    );
    let balance = 0n;
    for (const r of rows) balance += r.direction === 'CREDIT' ? BigInt(r.amount_minor) : -BigInt(r.amount_minor);
    return balance;
  }

  async function rowCount(table: string): Promise<number> {
    const rows: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ${table}`);
    return Number(rows[0].cnt);
  }

  async function tryTransfer(sourceId: string, destId: string, amount: string, idempotencyKey: string): Promise<{ success: boolean; error?: any; view?: any }> {
    try {
      const view = await transferService.createTransfer({ sourceWalletId: sourceId, destinationWalletId: destId, amountMinor: amount, currency: 'NGN', idempotencyKey });
      return { success: true, view };
    } catch (e: any) {
      return { success: false, error: e };
    }
  }

  // ── 1. success atomicity + snapshot content ──

  it('01. successful W→W creates exactly one FINAL snapshot referencing WALLET_TRANSFER + the exact transaction', async () => {
    const customerA = randomUUID();
    const customerB = randomUUID();
    const profile = 'PILOT_PROFILE_01';
    await seedProfile(profile);
    await seedAssignment(profile, 'CUSTOMER', customerA);
    const minRule = await seedLimitRule(profile, 'MIN_AMOUNT_PER_TX', '1000', null);
    const dailyAmtRule = await seedLimitRule(profile, 'DAILY_AMOUNT', '1000000', null);
    const dailyCntRule = await seedLimitRule(profile, 'DAILY_COUNT', null, 10);

    const wA = await createWallet(customerA);
    const wB = await createWallet(customerB);
    await fundWallet(wA.ledgerAccountId, '2000000');

    const idem = `pilot-01-${randomUUID()}`;
    const res = await tryTransfer(wA.id, wB.id, '50000', idem);
    expect(res.success).toBe(true);
    expect(res.view.status).toBe('COMPLETED');

    const snapshots: Array<any> = await dataSource.query(`SELECT * FROM commercial_decision_snapshots`);
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0];
    expect(snap.product).toBe('WALLET_TRANSFER');
    expect(snap.transaction_reference).toBe(res.view.id); // the exact transfer
    expect(snap.correlation_id).toBe(`transfer:${res.view.id}`);
    expect(snap.idempotency_key).toBe(`transfer:${res.view.id}`);
    expect(snap.journal_id).toBe(res.view.journalId);
    expect(snap.principal_type).toBe('CUSTOMER');
    expect(snap.principal_id).toBe(customerA);
    expect(snap.currency).toBe('NGN');
    expect(snap.principal_amount_minor.toString()).toBe('50000');
    expect(snap.direction).toBe('OUTGOING');
    expect(snap.decision_status).toBe('FINAL');
    expect(snap.decided_at).toBeDefined();
    expect(snap.finalized_at).toBeDefined();
    expect(snap.created_by).toBe('transfer-service');
    expect(snap.supersedes_snapshot_id).toBeNull();

    // fee = NOT_CONFIGURED (never ZERO, never a synthetic rule), commission/reward NONE, revenue null
    expect(snap.fee_decision.status).toBe('NOT_CONFIGURED');
    expect(snap.fee_decision.feeMinor).toBe('0');
    expect(snap.fee_decision.vatMinor).toBe('0');
    expect(snap.fee_decision.totalMinor).toBe('50000');
    expect(snap.fee_decision.amountMinor).toBe('50000');
    expect(snap.fee_decision.ruleRefs).toEqual([]);
    expect(snap.commission_decision).toEqual({ status: 'NONE', allocations: [], ruleRefs: [] });
    expect(snap.reward_decision).toEqual({ status: 'NONE', grants: [], ruleRefs: [] });
    expect(snap.revenue_decision).toBeNull();
    expect(snap.configuration_version).toBeNull();

    // limit decision = the AUTHORITATIVE live enforcement outcome with rule/reservation/usage evidence
    expect(snap.limit_decision.status).toBe('APPROVED');
    expect(snap.limit_decision.profileCode).toBe(profile);
    const limitRuleIds = snap.limit_decision.ruleRefs.map((r: any) => r.ruleId).sort();
    expect(limitRuleIds).toEqual([minRule, dailyAmtRule, dailyCntRule].sort());
    const dailyRef = snap.limit_decision.ruleRefs.find((r: any) => r.dimension === 'DAILY_AMOUNT');
    expect(dailyRef.limitValueMinor).toBe('1000000');
    // evidence ids point at the real reservation/usage rows created by THIS transfer
    const reservations: Array<any> = await dataSource.query(`SELECT id, limit_usage_id, status FROM limit_reservations WHERE idempotency_key=$1 ORDER BY id`, [idem]);
    expect(reservations.length).toBe(2); // DAILY_AMOUNT + DAILY_COUNT
    expect(snap.limit_decision.reservationIds.sort()).toEqual(reservations.map((r) => r.id).sort());
    expect(snap.limit_decision.usageIds.sort()).toEqual(reservations.map((r) => r.limit_usage_id).sort());
    // terminal limit state: committed usage, zero residual reservation
    const usages: Array<any> = await dataSource.query(`SELECT dimension, used_amount_minor::text AS amt, used_count, reserved_amount_minor::text AS ramt, reserved_count FROM limit_usages WHERE principal_id=$1`, [customerA]);
    const daily = usages.find((u) => u.dimension === 'DAILY_AMOUNT');
    expect(daily.amt).toBe('50000');
    expect(daily.ramt).toBe('0');
  });

  // ── 2. zero-fee financial proof ──

  it('02. zero fee financially: exactly two journal lines, both exactly the principal; no fee account/line', async () => {
    const customerA = randomUUID();
    const customerB = randomUUID();
    const wA = await createWallet(customerA);
    const wB = await createWallet(customerB);
    await fundWallet(wA.ledgerAccountId, '2000000');

    const accountsBefore = await rowCount('ledger_accounts');
    const balanceABefore = await walletBalance(wA.ledgerAccountId);
    const balanceBBefore = await walletBalance(wB.ledgerAccountId);

    const res = await tryTransfer(wA.id, wB.id, '77700', `pilot-02-${randomUUID()}`);
    expect(res.success).toBe(true);

    // the transfer journal contains exactly the principal DEBIT + principal CREDIT — nothing else
    const lines: Array<any> = await dataSource.query(
      `SELECT direction, amount_minor::text AS amount_minor, ledger_account_id FROM ledger_lines WHERE journal_id=$1 ORDER BY direction`,
      [res.view.journalId],
    );
    expect(lines).toHaveLength(2);
    const debit = lines.find((l) => l.direction === 'DEBIT');
    const credit = lines.find((l) => l.direction === 'CREDIT');
    expect(debit.amount_minor).toBe('77700');
    expect(debit.ledger_account_id).toBe(wA.ledgerAccountId);
    expect(credit.amount_minor).toBe('77700');
    expect(credit.ledger_account_id).toBe(wB.ledgerAccountId);

    // no fee revenue account appeared; wallet balances moved by exactly the principal
    expect(await rowCount('ledger_accounts')).toBe(accountsBefore);
    expect(await walletBalance(wA.ledgerAccountId)).toBe(balanceABefore - 77700n);
    expect(await walletBalance(wB.ledgerAccountId)).toBe(balanceBBefore + 77700n);
  });

  // ── 3. idempotency ──

  it('03. replay converges: same transfer id, exactly ONE snapshot, usage not double-counted', async () => {
    const customerA = randomUUID();
    const customerB = randomUUID();
    const profile = 'PILOT_PROFILE_03';
    await seedProfile(profile);
    await seedAssignment(profile, 'CUSTOMER', customerA);
    await seedLimitRule(profile, 'DAILY_AMOUNT', '1000000', null);
    const wA = await createWallet(customerA);
    const wB = await createWallet(customerB);
    await fundWallet(wA.ledgerAccountId, '2000000');

    const idem = `pilot-03-${randomUUID()}`;
    const first = await tryTransfer(wA.id, wB.id, '40000', idem);
    expect(first.success).toBe(true);
    const replay = await tryTransfer(wA.id, wB.id, '40000', idem);
    expect(replay.success).toBe(true);
    expect(replay.view.id).toBe(first.view.id);

    expect(await rowCount('commercial_decision_snapshots')).toBe(1);
    expect(await rowCount('transfers')).toBe(1);
    const usages: Array<any> = await dataSource.query(`SELECT used_amount_minor::text AS amt FROM limit_usages WHERE principal_id=$1 AND dimension='DAILY_AMOUNT'`, [customerA]);
    expect(usages[0].amt).toBe('40000'); // NOT 80000
    expect(await walletBalance(wA.ledgerAccountId)).toBe(2000000n - 40000n); // debited once
  });

  it('04. same idempotency key with a different payload remains rejected (409)', async () => {
    const customerA = randomUUID();
    const customerB = randomUUID();
    const wA = await createWallet(customerA);
    const wB = await createWallet(customerB);
    await fundWallet(wA.ledgerAccountId, '2000000');

    const idem = `pilot-04-${randomUUID()}`;
    const first = await tryTransfer(wA.id, wB.id, '30000', idem);
    expect(first.success).toBe(true);
    const clash = await tryTransfer(wA.id, wB.id, '30001', idem);
    expect(clash.success).toBe(false);
    expect(clash.error.getStatus()).toBe(409);
    expect(await rowCount('commercial_decision_snapshots')).toBe(1);
    expect(await rowCount('transfers')).toBe(1);
  });

  // ── 4. rollback atomicity ──

  it('05. downstream failure before commit rolls back snapshot + reservations + journal + wallet state', async () => {
    const customerA = randomUUID();
    const customerB = randomUUID();
    const profile = 'PILOT_PROFILE_05';
    await seedProfile(profile);
    await seedAssignment(profile, 'CUSTOMER', customerA);
    await seedLimitRule(profile, 'DAILY_AMOUNT', '1000000', null);
    const wA = await createWallet(customerA);
    const wB = await createWallet(customerB);
    await fundWallet(wA.ledgerAccountId, '2000000');

    const journalsBefore = await rowCount('ledger_journals');
    const balanceABefore = await walletBalance(wA.ledgerAccountId);
    const balanceBBefore = await walletBalance(wB.ledgerAccountId);

    failCompletedOutbox = true;
    try {
      const res = await tryTransfer(wA.id, wB.id, '60000', `pilot-05-${randomUUID()}`);
      expect(res.success).toBe(false); // the outbox write failed AFTER the snapshot was recorded in-tx
    } finally {
      failCompletedOutbox = false;
    }

    // everything rolled back together — the snapshot does NOT remain
    expect(await rowCount('commercial_decision_snapshots')).toBe(0);
    expect(await rowCount('transfers')).toBe(0);
    expect(await rowCount('limit_reservations')).toBe(0);
    expect(await rowCount('limit_usages')).toBe(0);
    expect(await rowCount('ledger_journals')).toBe(journalsBefore);
    expect(await walletBalance(wA.ledgerAccountId)).toBe(balanceABefore);
    expect(await walletBalance(wB.ledgerAccountId)).toBe(balanceBBefore);
  });

  // ── 5. synthetic fee rule captured without changing the financial transaction ──

  it('06. TEST-ONLY synthetic fee rule → snapshot captures ruleId/version/parameters; money flow unchanged', async () => {
    // synthetic rule inside the disposable test DB only — never production seed
    const rule = await feeRuleRegistry.createRule(
      {
        productCode: 'WALLET_TRANSFER',
        currency: 'NGN',
        flatFeeMinor: '250',
        percentageBps: 10,
        minimumFeeMinor: '100',
        maximumFeeMinor: '50000',
        vatBps: null,
        effectiveFrom: new Date(Date.now() - 86400000),
        priority: 0,
        isActive: true,
      },
      'test',
    );

    const customerA = randomUUID();
    const customerB = randomUUID();
    const wA = await createWallet(customerA);
    const wB = await createWallet(customerB);
    await fundWallet(wA.ledgerAccountId, '2000000');

    const res = await tryTransfer(wA.id, wB.id, '90000', `pilot-06-${randomUUID()}`);
    expect(res.success).toBe(true);

    const snapshots: Array<any> = await dataSource.query(`SELECT fee_decision FROM commercial_decision_snapshots`);
    expect(snapshots).toHaveLength(1);
    const fee = snapshots[0].fee_decision;
    // V1-COMMERCIAL-IMPLEMENTATION-01 — RESOLVED rule is now COMPUTED authoritatively:
    // fee = floor(90000·10bps/10000) + 250 = 90 + 250 = 340; min/max inert here
    expect(fee.status).toBe('APPLIED');
    expect(fee.feeMinor).toBe('340');
    expect(fee.totalMinor).toBe('90340');
    expect(fee.calculationModel).toBe('FLAT_PLUS_PERCENTAGE');
    expect(fee.percentageFeeComponentMinor).toBe('90');
    expect(fee.flatFeeComponentMinor).toBe('250');
    expect(fee.minimumApplied).toBe(false);
    expect(fee.maximumApplied).toBe(false);
    expect(fee.posting).toEqual({
      journalLegsPosted: false,
      reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED',
    }); // accounting boundary — journal below stays principal-only
    // ...and the resolved rule evidence is still captured exactly
    expect(fee.ruleRefs).toHaveLength(1);
    expect(fee.ruleRefs[0].ruleId).toBe(rule.id);
    expect(fee.ruleRefs[0].ruleVersion).toBe(1);
    expect(fee.ruleRefs[0].flatFeeMinor).toBe('250');
    expect(fee.ruleRefs[0].percentageBps).toBe(10);
    expect(fee.ruleRefs[0].minimumFeeMinor).toBe('100');
    expect(fee.ruleRefs[0].maximumFeeMinor).toBe('50000');

    // financial transaction UNCHANGED: exactly two lines, principal only (accounting boundary —
    // the computed fee is a decision-layer fact; no fee/vat leg was posted)
    const lines: Array<any> = await dataSource.query(
      `SELECT direction, amount_minor::text AS amount_minor FROM ledger_lines WHERE journal_id=$1`,
      [res.view.journalId],
    );
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('90000');
    expect(await walletBalance(wA.ledgerAccountId)).toBe(2000000n - 90000n);
    expect(await walletBalance(wB.ledgerAccountId)).toBe(90000n);
  });

  // ── 6. immutability, no-profile limit path, and unchanged behavior ──

  it('07. snapshot remains immutable (UPDATE/DELETE blocked by trigger)', async () => {
    const customerA = randomUUID();
    const customerB = randomUUID();
    const wA = await createWallet(customerA);
    const wB = await createWallet(customerB);
    await fundWallet(wA.ledgerAccountId, '2000000');
    const res = await tryTransfer(wA.id, wB.id, '25000', `pilot-07-${randomUUID()}`);
    expect(res.success).toBe(true);

    const snapshots: Array<any> = await dataSource.query(`SELECT id FROM commercial_decision_snapshots`);
    expect(snapshots).toHaveLength(1);
    await expect(
      dataSource.query(`UPDATE commercial_decision_snapshots SET product='X' WHERE id=$1`, [snapshots[0].id]),
    ).rejects.toThrow(/commercial_decision_snapshots is immutable/);
    await expect(dataSource.query(`DELETE FROM commercial_decision_snapshots WHERE id=$1`, [snapshots[0].id])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );
    expect(await rowCount('commercial_decision_snapshots')).toBe(1);
  });

  it('08. W→W without any limit configuration still records a snapshot (limits evaluated, none applicable)', async () => {
    const customerA = randomUUID();
    const customerB = randomUUID();
    const wA = await createWallet(customerA);
    const wB = await createWallet(customerB);
    await fundWallet(wA.ledgerAccountId, '2000000');

    const res = await tryTransfer(wA.id, wB.id, '15000', `pilot-08-${randomUUID()}`);
    expect(res.success).toBe(true);
    expect(res.view.status).toBe('COMPLETED');
    expect(res.view.completedAt).toBeTruthy();
    expect(res.view.paymentReference).toBeTruthy();

    const snapshots: Array<any> = await dataSource.query(`SELECT limit_decision, fee_decision FROM commercial_decision_snapshots`);
    expect(snapshots).toHaveLength(1);
    // enforcement ran (authoritative), found no applicable profile/rules → approved with empty evidence
    expect(snapshots[0].limit_decision.status).toBe('APPROVED');
    expect(snapshots[0].limit_decision.profileCode).toBeNull();
    expect(snapshots[0].limit_decision.ruleRefs).toEqual([]);
    expect(snapshots[0].limit_decision.reservationIds).toEqual([]);
    expect(snapshots[0].limit_decision.usageIds).toEqual([]);
    expect(snapshots[0].fee_decision.status).toBe('NOT_CONFIGURED');
  });

  it('09. a limit-rejected W→W leaves NO snapshot (failed transfers never record one) and existing failure semantics intact', async () => {
    const customerA = randomUUID();
    const customerB = randomUUID();
    const profile = 'PILOT_PROFILE_09';
    await seedProfile(profile);
    await seedAssignment(profile, 'CUSTOMER', customerA);
    await seedLimitRule(profile, 'DAILY_AMOUNT', '50000', null); // tighter than the transfer
    const wA = await createWallet(customerA);
    const wB = await createWallet(customerB);
    await fundWallet(wA.ledgerAccountId, '2000000');

    const res = await tryTransfer(wA.id, wB.id, '60000', `pilot-09-${randomUUID()}`);
    expect(res.success).toBe(false); // existing limit-breach failure path unchanged
    expect(await rowCount('commercial_decision_snapshots')).toBe(0); // no snapshot for failed transfer
    expect(await rowCount('limit_reservations')).toBe(0);
    // pre-existing limit semantics: enforcement creates the usage row BEFORE validating, so a
    // rejected transfer leaves a usage row with ZERO consumption — assert nothing was consumed
    const usages: Array<any> = await dataSource.query(
      `SELECT used_amount_minor::text AS amt, used_count, reserved_amount_minor::text AS ramt, reserved_count FROM limit_usages`,
    );
    for (const u of usages) {
      expect(u.amt).toBe('0');
      expect(u.ramt).toBe('0');
      expect(u.used_count).toBe(0);
      expect(u.reserved_count).toBe(0);
    }
    expect(await walletBalance(wA.ledgerAccountId)).toBe(2000000n); // untouched
    expect(await walletBalance(wB.ledgerAccountId)).toBe(0n);
  });

  it('10. workforce diagnostic read API verifies the pilot snapshot (no duplicate read APIs created)', async () => {
    const customerA = randomUUID();
    const customerB = randomUUID();
    const wA = await createWallet(customerA);
    const wB = await createWallet(customerB);
    await fundWallet(wA.ledgerAccountId, '2000000');
    const res = await tryTransfer(wA.id, wB.id, '12000', `pilot-10-${randomUUID()}`);
    expect(res.success).toBe(true);

    const request = require('supertest');
    const list = await request(app.getHttpServer())
      .get('/api/v1/internal/commercial-decision-snapshots')
      .set('Authorization', 'Bearer workforce-operator')
      .expect(200);
    const body = list.body;
    const items = Array.isArray(body) ? body : body.data ?? body.items ?? [];
    expect(items.length).toBeGreaterThanOrEqual(1);
    const found = items.find((s: any) => s.transactionReference === res.view.id || s.transaction_reference === res.view.id);
    expect(found).toBeDefined();
  });
});
