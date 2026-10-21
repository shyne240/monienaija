/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unsafe-argument */
// @ts-nocheck
/**
 * V1-COMMERCIAL-IMPLEMENTATION-01 — FEE ENGINE RUNTIME WIRING (real PG).
 *
 * Proves, against real PostgreSQL and the REAL transaction services, that fee calculation is
 * now wired at runtime through the existing authority chain ONLY:
 *   FeeRuleResolverService (read-only resolution, in-transaction)
 *     → FeeRuleCalculatorService (pure deterministic BigInt computation)
 *     → CommercialDecisionSnapshot (immutable decision record, same atomic transaction).
 *
 * Covered here:
 *   1. flat-only rule → APPLIED with exact evidence; journal unchanged (principal-only)
 *   2. percentage rule with min/max clamps — below-min / at-min / between / at-max / above-max
 *   3. percentage rounding is FLOOR with explicit evidence
 *   4. VAT (rule-carried rate) computed on the clamped fee with evidence; still no vat ledger leg
 *   5. rule priority precedence (highest priority wins)
 *   6. rule ambiguity → preserved AMBIGUOUS evidence shape; NO fee charged
 *   7. effective-window exclusion (future rule / expired rule → NOT_CONFIGURED fallback)
 *   8. zero-parameter rule (a FREE configuration) → status ZERO, fee 0, no charge
 *   9. idempotent replay (serial + concurrent) never double-computes / double-records the fee
 *  10. transaction failure rolls back snapshot + fee decision together with the journal
 *  11. customer history projection exposes principal/fee/currency safely, no internals
 *  12. CASH_TO_CASH initiation: fee snapshot APPLIED; journal stays principal-only
 *  13. CASH_TO_CASH claim: the replicated fee decision is BIT-FOR-BIT identical to initiation
 *  14. CUSTOMER_FUNDING FREE: no rule → NOT_CONFIGURED, fee 0, no fee/vat ledger line
 *
 * PROVISIONAL TEST CONFIGURATION ONLY — every rule seeded here lives exclusively inside this
 * disposable per-process test database. These are NOT production rates, NOT a pricing policy,
 * and are never seeded into production data.
 *
 * ACCOUNTING BOUNDARY (asserted, not assumed): every APPLIED/ZERO decision carries
 *   posting: { journalLegsPosted: false, reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED' }
 * and the journal remains exactly DEBIT/CREDIT principal-only. No ledger account codes were
 * invented; fee revenue posting awaits provisioning of the authoritative revenue family.
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, randomBytes, pbkdf2Sync } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { OutboxService } from '../src/operations/outbox.service';
import { WalletService } from '../src/wallet/wallet.service';
import { TransferService } from '../src/transfer/transfer.service';
import { LedgerService } from '../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { CustomerFundingService } from '../src/customer-funding/customer-funding.service';
import { CustomerTransactionHistoryService } from '../src/customer-app/customer-transaction-history.service';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashToCashService } from '../src/agent/agent-cash-to-cash.service';
import { AgentCashToCashClaimService } from '../src/agent/agent-cash-to-cash-claim.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { MfaExecutionService } from '../src/customer-authentication/mfa-execution.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

const POSTING_BLOCKED = {
  journalLegsPosted: false,
  reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED',
};

describe('V1-COMMERCIAL-IMPLEMENTATION-01 Fee runtime wiring (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let transferService: TransferService;
  let ledgerService: LedgerService;
  let feeRuleRegistry: FeeRuleRegistryService;
  let fundingService: CustomerFundingService;
  let historyService: CustomerTransactionHistoryService;
  let cashToCashService: AgentCashToCashService;
  let claimService: AgentCashToCashClaimService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let mfaService: MfaExecutionService;

  let systemLedgerAccountId: string;

  // Rollback hook (mirrors decision-02): when armed, the COMPLETED outbox write throws AFTER the
  // snapshot was recorded, forcing rollback of snapshot+journal+fee together.
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
      if (!token || !token.startsWith('workforce-')) {
        throw new UnauthorizedException('invalid workforce token');
      }
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

  const throwingOutbox = {
    enqueue: async (_manager: unknown, event: { eventType: string }) => {
      if (failCompletedOutbox && event.eventType === 'transfer.completed') {
        throw new Error('simulated downstream failure before commit');
      }
    },
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-fee-runtime-01');
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await (app.getHttpAdapter().getInstance() as any).ready();
    walletService = app.get(WalletService);
    transferService = app.get(TransferService);
    ledgerService = app.get(LedgerService);
    feeRuleRegistry = app.get(FeeRuleRegistryService);
    fundingService = app.get(CustomerFundingService);
    historyService = app.get(CustomerTransactionHistoryService);
    cashToCashService = app.get(AgentCashToCashService);
    claimService = app.get(AgentCashToCashClaimService);
    classService = app.get(AgentClassService);
    appService = app.get(AgentApplicationService);
    lifecycleService = app.get(AgentLifecycleService);
    pinService = app.get(AgentAuthenticationService);
    mfaService = app.get(MfaExecutionService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    failCompletedOutbox = false;
    await truncateAllTables(dataSource);
    await app.get(ProductCatalogSeedService).seedIfEmpty();
    // Infrastructure ledger accounts (system float + cash-to-cash unclaimed liability) — these
    // are seed/test fixture accounts, NOT fee-revenue accounts (none exist; see header).
    const sys = await ledgerService.createAccount({
      code: `SYS-FLOAT-NGN-${randomUUID().slice(0, 6)}`,
      name: 'System Float NGN',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    systemLedgerAccountId = sys.id;
    await ledgerService.createAccount({
      code: 'CASH_TO_CASH-UNCLAIMED-NGN',
      name: 'Cash-to-Cash Unclaimed NGN',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
    // Authoritative settlement control account (migration-seeded in production; provision
    // defensively like v1-001/03d after the per-test truncate).
    await dataSource.query(`
      INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
      VALUES ('00000000-0000-4000-8000-000000000201','PAYMENT-SETTLEMENT_ASSET-NGN','Payment settlement asset NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE)
      ON CONFLICT (code) DO NOTHING
    `);
  });

  // ── harness helpers (synthetic test data only) ──

  async function seedFeeRule(input: {
    productCode: string;
    flatFeeMinor?: string | null;
    percentageBps?: number | null;
    minimumFeeMinor?: string | null;
    maximumFeeMinor?: string | null;
    vatBps?: number | null;
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
    priority?: number;
  }): Promise<string> {
    const rule = await feeRuleRegistry.createRule(
      {
        productCode: input.productCode,
        currency: 'NGN',
        flatFeeMinor: input.flatFeeMinor ?? null,
        percentageBps: input.percentageBps ?? null,
        minimumFeeMinor: input.minimumFeeMinor ?? null,
        maximumFeeMinor: input.maximumFeeMinor ?? null,
        vatBps: input.vatBps ?? null,
        effectiveFrom: input.effectiveFrom ?? new Date(Date.now() - 86400000),
        ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo }),
        priority: input.priority ?? 0,
        isActive: true,
      },
      'test',
    );
    return rule.id;
  }

  async function createWallet(
    customerId: string,
  ): Promise<{ id: string; ledgerAccountId: string }> {
    const view = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `test-${customerId}-${randomUUID()}`,
    });
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [view.id],
    );
    return { id: view.id, ledgerAccountId: rows[0].ledger_account_id };
  }

  async function fundWallet(walletLedgerAccountId: string, amountMinor: string): Promise<void> {
    await dataSource.transaction(async (manager) => {
      await ledgerService.postJournalInTransaction(manager, {
        idempotencyKey: `fund-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: `FUND-${walletLedgerAccountId.slice(0, 8)}`,
        lines: [
          { accountId: systemLedgerAccountId, direction: 'DEBIT', amountMinor },
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
    for (const r of rows) {
      balance += r.direction === 'CREDIT' ? BigInt(r.amount_minor) : -BigInt(r.amount_minor);
    }
    return balance;
  }

  async function tryTransfer(
    sourceId: string,
    destId: string,
    amount: string,
    idempotencyKey: string,
  ): Promise<{ success: boolean; error?: any; view?: any }> {
    try {
      const view = await transferService.createTransfer({
        sourceWalletId: sourceId,
        destinationWalletId: destId,
        amountMinor: amount,
        currency: 'NGN',
        idempotencyKey,
      });
      return { success: true, view };
    } catch (e: any) {
      return { success: false, error: e };
    }
  }

  async function snapshotsFor(where: string, params: unknown[]): Promise<Array<any>> {
    return dataSource.query(`SELECT * FROM commercial_decision_snapshots WHERE ${where}`, params);
  }

  async function journalLines(journalId: string): Promise<Array<any>> {
    return dataSource.query(
      `SELECT direction, amount_minor::text AS amount_minor, ledger_account_id FROM ledger_lines WHERE journal_id=$1 ORDER BY direction`,
      [journalId],
    );
  }

  async function seedCustomerLimitProfile(
    code: string,
    subjectType: 'AGENT' | 'CUSTOMER',
    subjectId: string,
    product: string,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ($1,$2,$3,'ACTIVE',true,'CONFIGURED','test')`,
      [code, `Profile ${code}`, subjectType],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,$3,$4,NULL,0,$5,NULL,true,'test')`,
      [randomUUID(), code, subjectType, subjectId, new Date(Date.now() - 86400000).toISOString()],
    );
    await dataSource.query(
      `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,$3,NULL,NULL,'NGN','DAILY_AMOUNT','100000000',NULL,$4,NULL,true,'test')`,
      [randomUUID(), code, product, new Date(Date.now() - 86400000).toISOString()],
    );
  }

  /** Persisted transfers.fee_minor slot: the fee ACTUALLY POSTED on this transfer (always '0' at
   *  the current accounting boundary — the computed fee lives in the snapshot). */
  async function persistedFeeSlot(
    transferId: string,
  ): Promise<{ fee_minor: string; vat_minor: string }> {
    const rows: Array<{ fee_minor: string; vat_minor: string }> = await dataSource.query(
      `SELECT fee_minor::text AS fee_minor, vat_minor::text AS vat_minor FROM transfers WHERE id=$1`,
      [transferId],
    );
    return rows[0];
  }

  // ── 01. flat-only rule → APPLIED; journal unchanged ──

  it('01. WALLET_TRANSFER flat-only rule → APPLIED with exact fee; journal stays principal-only', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '50' });
    const customerA = randomUUID();
    const wA = await createWallet(customerA);
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');

    const res = await tryTransfer(wA.id, wB.id, '21000', `fee-01-${randomUUID()}`);
    expect(res.success).toBe(true);

    const snaps = await snapshotsFor(`journal_id = $1`, [res.view.journalId]);
    expect(snaps).toHaveLength(1);
    const fee = snaps[0].fee_decision;
    expect(fee.status).toBe('APPLIED');
    expect(fee.calculationModel).toBe('FLAT');
    expect(fee.feeMinor).toBe('50');
    expect(fee.vatMinor).toBe('0');
    expect(fee.totalMinor).toBe('21050'); // principal + fee (+ vat)
    expect(fee.flatFeeComponentMinor).toBe('50');
    expect(fee.percentageFeeComponentMinor).toBe('0');
    expect(fee.rawFeeMinor).toBe('50');
    expect(fee.minimumApplied).toBe(false);
    expect(fee.maximumApplied).toBe(false);
    expect(fee.roundingApplied).toBeNull(); // no percentage path → no rounding
    expect(fee.vatApplied).toBe(false);
    expect(fee.vatBasisMinor).toBeNull();
    expect(fee.posting).toEqual(POSTING_BLOCKED);
    expect(fee.ruleRefs).toHaveLength(1);
    expect(typeof fee.ruleRefs[0].ruleId).toBe('string');

    // principal/fee distinguishable: ledger moved exactly 21000 (2 lines), fee slot stays '0'
    const lines = await journalLines(res.view.journalId);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('21000');
    expect(await walletBalance(wA.ledgerAccountId)).toBe(100000n - 21000n);
    expect(await walletBalance(wB.ledgerAccountId)).toBe(21000n);
    expect(await persistedFeeSlot(res.view.id)).toEqual({ fee_minor: '0', vat_minor: '0' });
  });

  // ── 02. percentage rule + min/max clamp ladder ──

  it('02. WALLET_TRANSFER percentage rule: below-min / at-min / between / at-max / above-max ladder', async () => {
    // provisional test config: 10bps, min 500, max 2500 (NOT production pricing)
    await seedFeeRule({
      productCode: 'WALLET_TRANSFER',
      percentageBps: 10,
      minimumFeeMinor: '500',
      maximumFeeMinor: '2500',
    });
    const cases: Array<{
      label: string;
      principal: string;
      raw: string;
      fee: string;
      minApplied: boolean;
      maxApplied: boolean;
    }> = [
      {
        label: 'below-min',
        principal: '10000',
        raw: '10',
        fee: '500',
        minApplied: true,
        maxApplied: false,
      },
      {
        label: 'at-min',
        principal: '500000',
        raw: '500',
        fee: '500',
        minApplied: false,
        maxApplied: false,
      },
      {
        label: 'between',
        principal: '1000000',
        raw: '1000',
        fee: '1000',
        minApplied: false,
        maxApplied: false,
      },
      {
        label: 'at-max',
        principal: '2500000',
        raw: '2500',
        fee: '2500',
        minApplied: false,
        maxApplied: false,
      },
      {
        label: 'above-max',
        principal: '10000000',
        raw: '10000',
        fee: '2500',
        minApplied: false,
        maxApplied: true,
      },
    ];
    for (const c of cases) {
      const wA = await createWallet(randomUUID());
      const wB = await createWallet(randomUUID());
      await fundWallet(wA.ledgerAccountId, '20000000');
      const res = await tryTransfer(wA.id, wB.id, c.principal, `fee-02-${c.label}-${randomUUID()}`);
      expect(res.success).toBe(true);
      const snaps = await snapshotsFor(`journal_id = $1`, [res.view.journalId]);
      expect(snaps).toHaveLength(1);
      const fee = snaps[0].fee_decision;
      expect(fee.status).toBe('APPLIED');
      expect(fee.calculationModel).toBe('PERCENTAGE');
      expect(fee.percentageFeeComponentMinor).toBe(c.raw);
      expect(fee.rawFeeMinor).toBe(c.raw);
      expect(fee.feeMinor).toBe(c.fee);
      expect(fee.minimumApplied).toBe(c.minApplied);
      expect(fee.maximumApplied).toBe(c.maxApplied);
      expect(fee.totalMinor).toBe((BigInt(c.principal) + BigInt(c.fee)).toString());
      expect(fee.posting).toEqual(POSTING_BLOCKED);
      // money moved is principal only — the computed fee is decision-layer only
      const lines = await journalLines(res.view.journalId);
      expect(lines).toHaveLength(2);
      for (const l of lines) expect(l.amount_minor).toBe(c.principal);
    }
  });

  // ── 03. FLOOR rounding evidence ──

  it('03. percentage rounding floors fractional minor units with explicit evidence', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', percentageBps: 10 });
    const wA = await createWallet(randomUUID());
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');
    // floor(1550 * 10 / 10000) = floor(1.55) = 1 kobo
    const res = await tryTransfer(wA.id, wB.id, '1550', `fee-03-${randomUUID()}`);
    expect(res.success).toBe(true);
    const snaps = await snapshotsFor(`journal_id = $1`, [res.view.journalId]);
    const fee = snaps[0].fee_decision;
    expect(fee.status).toBe('APPLIED');
    expect(fee.feeMinor).toBe('1');
    expect(fee.percentageFeeComponentMinor).toBe('1');
    expect(fee.roundingApplied).toBe('FLOOR');
    expect(fee.totalMinor).toBe('1551');
  });

  // ── 04. VAT on the clamped fee, evidence-only (no vat ledger leg) ──

  it('04. rule-carried VAT computes on the clamped fee; journal still has NO vat leg', async () => {
    // provisional: flat 1000 with vat 750bps → vat = floor(1000*750/10000) = 75
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 750 });
    const wA = await createWallet(randomUUID());
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');
    const res = await tryTransfer(wA.id, wB.id, '5000', `fee-04-${randomUUID()}`);
    expect(res.success).toBe(true);
    const snaps = await snapshotsFor(`journal_id = $1`, [res.view.journalId]);
    const fee = snaps[0].fee_decision;
    expect(fee.status).toBe('APPLIED');
    expect(fee.feeMinor).toBe('1000');
    expect(fee.vatApplied).toBe(true);
    expect(fee.vatRateBps).toBe(750);
    expect(fee.vatBasisMinor).toBe('1000'); // on the CLAMPED fee
    expect(fee.vatMinor).toBe('75');
    expect(fee.totalMinor).toBe('6075');
    const lines = await journalLines(res.view.journalId);
    expect(lines).toHaveLength(2); // principal only — no fee leg, no vat leg
    for (const l of lines) expect(l.amount_minor).toBe('5000');
  });

  // ── 05. priority precedence ──

  it('05. competing live rules: the HIGHEST priority rule wins and is the one computed', async () => {
    const loser = await seedFeeRule({
      productCode: 'WALLET_TRANSFER',
      flatFeeMinor: '70',
      priority: 1,
    });
    const winner = await seedFeeRule({
      productCode: 'WALLET_TRANSFER',
      flatFeeMinor: '90',
      priority: 10,
    });
    const wA = await createWallet(randomUUID());
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');
    const res = await tryTransfer(wA.id, wB.id, '3000', `fee-05-${randomUUID()}`);
    expect(res.success).toBe(true);
    const snaps = await snapshotsFor(`journal_id = $1`, [res.view.journalId]);
    const fee = snaps[0].fee_decision;
    expect(fee.status).toBe('APPLIED');
    expect(fee.feeMinor).toBe('90');
    expect(fee.ruleRefs).toHaveLength(1);
    expect(fee.ruleRefs[0].ruleId).toBe(winner);
    expect(fee.ruleRefs[0].ruleId).not.toBe(loser);
    expect(fee.ruleRefs[0].priority).toBe(10);
  });

  // ── 06. ambiguity preserved; NO fee charged ──

  it('06. AMBIGUOUS resolution (two same-priority live rules) → preserved evidence shape, fee stays 0', async () => {
    const r1 = await seedFeeRule({
      productCode: 'WALLET_TRANSFER',
      flatFeeMinor: '70',
      priority: 5,
    });
    const r2 = await seedFeeRule({
      productCode: 'WALLET_TRANSFER',
      flatFeeMinor: '90',
      priority: 5,
    });
    const wA = await createWallet(randomUUID());
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');
    const res = await tryTransfer(wA.id, wB.id, '3000', `fee-06-${randomUUID()}`);
    expect(res.success).toBe(true);
    const snaps = await snapshotsFor(`journal_id = $1`, [res.view.journalId]);
    const fee = snaps[0].fee_decision;
    // byte-compatible with the pre-wiring AMBIGUOUS evidence (never silently selects a winner)
    expect(fee.status).toBe('NOT_CONFIGURED');
    expect(fee.resolutionStatus).toBe('AMBIGUOUS');
    expect(new Set(fee.ambiguousRuleIds)).toEqual(new Set([r1, r2]));
    expect(fee.feeMinor).toBe('0');
    expect(fee.totalMinor).toBe('3000');
    const lines = await journalLines(res.view.journalId);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('3000');
  });

  // ── 07. effective-window exclusion → NOT_CONFIGURED ──

  it('07. rules outside their effective window never apply (zero-fee fallback)', async () => {
    await seedFeeRule({
      productCode: 'WALLET_TRANSFER',
      flatFeeMinor: '100',
      effectiveFrom: new Date(Date.now() + 86400000), // future
    });
    await seedFeeRule({
      productCode: 'WALLET_TRANSFER',
      flatFeeMinor: '200',
      priority: 10,
      effectiveFrom: new Date(Date.now() - 2 * 86400000),
      effectiveTo: new Date(Date.now() - 86400000), // expired
    });
    const wA = await createWallet(randomUUID());
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');
    const res = await tryTransfer(wA.id, wB.id, '3000', `fee-07-${randomUUID()}`);
    expect(res.success).toBe(true);
    const snaps = await snapshotsFor(`journal_id = $1`, [res.view.journalId]);
    const fee = snaps[0].fee_decision;
    expect(fee.status).toBe('NOT_CONFIGURED');
    expect(fee.feeMinor).toBe('0');
    expect(fee.totalMinor).toBe('3000');
  });

  // ── 08. zero-parameter rule → ZERO (a FREE configuration resolved explicitly) ──

  it('08. zero-parameter WALLET_TRANSFER rule → status ZERO; no charge, explicit evidence', async () => {
    await seedFeeRule({
      productCode: 'WALLET_TRANSFER',
      flatFeeMinor: '0',
    });
    const wA = await createWallet(randomUUID());
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');
    const res = await tryTransfer(wA.id, wB.id, '8000', `fee-08-${randomUUID()}`);
    expect(res.success).toBe(true);
    const snaps = await snapshotsFor(`journal_id = $1`, [res.view.journalId]);
    const fee = snaps[0].fee_decision;
    expect(fee.status).toBe('ZERO');
    expect(fee.calculationModel).toBe('ZERO');
    expect(fee.feeMinor).toBe('0');
    expect(fee.totalMinor).toBe('8000');
    expect(fee.rawFeeMinor).toBe('0');
    expect(fee.minimumApplied).toBe(false);
    expect(fee.maximumApplied).toBe(false);
    expect(fee.posting).toEqual(POSTING_BLOCKED);
    expect(fee.ruleRefs).toHaveLength(1);
    const lines = await journalLines(res.view.journalId);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('8000');
  });

  // ── 09. idempotent replay — never double-fee ──

  it('09. idempotent replay (serial + concurrent) yields exactly ONE transfer / ONE snapshot / ONE fee decision', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '120' });
    const wA = await createWallet(randomUUID());
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');
    const key = `fee-09-${randomUUID()}`;

    const first = await tryTransfer(wA.id, wB.id, '9000', key);
    expect(first.success).toBe(true);
    // serial replay — same key, same payload
    const replay = await tryTransfer(wA.id, wB.id, '9000', key);
    expect(replay.success).toBe(true);
    expect(replay.view.id).toBe(first.view.id);

    const wC = await createWallet(randomUUID());
    const wD = await createWallet(randomUUID());
    await fundWallet(wC.ledgerAccountId, '100000');
    const key2 = `fee-09c-${randomUUID()}`;
    const concurrent = await Promise.all([
      tryTransfer(wC.id, wD.id, '9000', key2),
      tryTransfer(wC.id, wD.id, '9000', key2),
    ]);
    expect(concurrent.every((r) => r.success)).toBe(true);
    expect(concurrent[0].view.id).toBe(concurrent[1].view.id);

    const allSnaps = await dataSource.query(
      `SELECT journal_id, fee_decision FROM commercial_decision_snapshots ORDER BY created_at`,
    );
    expect(allSnaps).toHaveLength(2); // one per transfer, not per attempt
    for (const s of allSnaps) {
      expect(s.fee_decision.status).toBe('APPLIED');
      expect(s.fee_decision.feeMinor).toBe('120');
    }
    const transferCount = await dataSource.query(
      `SELECT count(*)::text AS cnt FROM transfers WHERE idempotency_key IN ($1,$2)`,
      [key, key2],
    );
    expect(transferCount[0].cnt).toBe('2');
    expect(await walletBalance(wC.ledgerAccountId)).toBe(100000n - 9000n); // charged once
  });

  // ── 10. transaction failure — no residual fee liability ──

  it('10. downstream failure rolls back snapshot + computed fee decision + journal atomically', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '200' });
    const wA = await createWallet(randomUUID());
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');
    const beforeA = await walletBalance(wA.ledgerAccountId);
    const journalsBefore = (
      await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`)
    )[0].cnt;

    failCompletedOutbox = true;
    try {
      const res = await tryTransfer(wA.id, wB.id, '5000', `fee-10-${randomUUID()}`);
      expect(res.success).toBe(false);
    } finally {
      failCompletedOutbox = false;
    }

    expect(
      (await dataSource.query(`SELECT count(*)::text AS cnt FROM commercial_decision_snapshots`))[0]
        .cnt,
    ).toBe('0');
    expect((await dataSource.query(`SELECT count(*)::text AS cnt FROM transfers`))[0].cnt).toBe(
      '0',
    );
    expect(
      (await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`))[0].cnt,
    ).toBe(journalsBefore);
    expect(await walletBalance(wA.ledgerAccountId)).toBe(beforeA);

    // retry succeeds and computes the same fee — no half-posted fee liability
    const retry = await tryTransfer(wA.id, wB.id, '5000', `fee-10-retry-${randomUUID()}`);
    expect(retry.success).toBe(true);
    const snaps = await snapshotsFor(`journal_id = $1`, [retry.view.journalId]);
    expect(snaps[0].fee_decision.feeMinor).toBe('200');
  });

  // ── 11. customer-safe projection ──

  it('11. unified history exposes principal/fee/currency without ledger internals (fee slot real, still 0)', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '75' });
    const customerA = randomUUID();
    const wA = await createWallet(customerA);
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');
    const res = await tryTransfer(wA.id, wB.id, '4000', `fee-11-${randomUUID()}`);
    expect(res.success).toBe(true);

    const page = await historyService.listUnified({ customerId: customerA, page: 1, limit: 20 });
    const item = page.items.find((i: any) => i.type === 'WALLET_TRANSFER' && i.id === res.view.id);
    expect(item).toBeDefined();
    expect(item.amountMinor).toBe('4000'); // principal
    expect(item.currency).toBe('NGN');
    expect(item.feeMinor).toBe('0'); // real column: no fee POSTED (accounting boundary); decision carries the computed '75'
    // internal machinery never leaks
    for (const k of [
      'journalId',
      'ledgerAccountId',
      'outboxId',
      'decisionPayload',
      'limitDecision',
      'commercialDecision',
      'snapshotId',
      'feeDecision',
    ]) {
      expect(item).not.toHaveProperty(k);
    }

    // the computed (unposted) fee is still recoverable for disclosure from the decision record
    const snaps = await snapshotsFor(`journal_id = $1`, [res.view.journalId]);
    expect(snaps[0].fee_decision.feeMinor).toBe('75');
  });

  // ── 12. CASH_TO_CASH initiation: APPLIED fee, principal-only journal ──

  async function createActiveAgentWithPin(pin: string | null, isActive = true) {
    const cls = await classService.create({
      reference: `cls-fee-${randomUUID().slice(0, 8)}`,
      code: `CFEE-${randomUUID().slice(0, 6)}`,
      name: 'FEE Class',
      isActive,
      applicableServices: [AgentService.CASH_TO_CASH],
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz FEE ${randomUUID().slice(0, 4)}`,
      contactEmail: `fee-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-fee',
    });
    await appService.submit(appEntity.id, 'applicant-fee');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [appEntity.id],
    );
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    if (pin !== null) {
      await pinService.setTransactionPin(agent.id, {
        pinHash: hashPin(pin),
        hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
        pinVersion: 1,
        actor: agent.id,
      });
    }
    const wallet = await walletService.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `agent-wallet-${agent.id}-${randomUUID()}`,
    });
    return { cls, agent, appEntity, wallet };
  }

  function agentPrincipal(agentId: string) {
    return {
      type: 'AGENT' as const,
      agentId,
      principalId: agentId,
      roles: [],
      scopes: [],
      customerAccess: 'NONE' as const,
      agentAccess: 'SELF' as const,
    };
  }

  function newPhone(): string {
    return `80${Math.floor(10000000 + Math.random() * 89999999)}`;
  }

  async function fundAgent(agentWalletLedgerId: string, amount: string): Promise<void> {
    await ledgerService.postJournal({
      idempotencyKey: `fund-agent-${agentWalletLedgerId}-${amount}-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        {
          accountId: systemLedgerAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: amount,
        },
        {
          accountId: agentWalletLedgerId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: amount,
        },
      ],
    });
  }

  async function createCustomerWithPhone(phoneCanonical: string) {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-fee-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0].id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer FEE',true)`,
      [customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$2,true,NOW())`,
      [customerId, phoneCanonical],
    );
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `cust-wallet-${customerId}-${randomUUID()}`,
    });
    return { customerId, wallet };
  }

  async function createMfaChallenge(customerId: string, otp: string, ttlSeconds = 300) {
    const eRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO mfa_enrollments (id, customer_id, reference, status) VALUES ($1,$2,$3,'ENABLED') RETURNING id`,
      [randomUUID(), customerId, `mfa-enroll-${randomUUID().slice(0, 6)}`],
    );
    const enrollmentId = eRows[0].id;
    const mRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
      [randomUUID(), customerId, enrollmentId, `mfa-method-${randomUUID().slice(0, 6)}`],
    );
    const methodId = mRows[0].id;
    const cRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customer_authentication_credentials (id, customer_id, credential_type, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PASSWORD','dummyhash','PBKDF2',1,NOW(),'ACTIVE') RETURNING id`,
      [randomUUID(), customerId],
    );
    const credentialId = cRows[0].id;
    const sessionId = randomUUID();
    const tokenHash = randomBytes(32).toString('hex');
    await dataSource
      .query(
        `INSERT INTO authentication_sessions (id, customer_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at) VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',NOW(),NOW() + INTERVAL '1 hour',NOW())`,
        [sessionId, customerId, credentialId, tokenHash],
      )
      .catch(() => {});
    const principal: any = { principalType: 'CUSTOMER', customerId, credentialId, sessionId };
    const challenge = await mfaService.issueChallenge({
      principal,
      enrollmentId,
      methodId,
      challengeHash: otp,
      ttlSeconds,
      actor: customerId,
    } as any);
    return { challengeId: (challenge as any).id ?? (challenge as any).challengeId, otp };
  }

  it('12. CASH_TO_CASH initiation: rule computes APPLIED fee snapshot; journal stays principal-only', async () => {
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '125', priority: 0 });
    const { agent, wallet: agentWallet } = await createActiveAgentWithPin('1234');
    await fundAgent(agentWallet.ledgerAccountId, '100000');
    await seedCustomerLimitProfile(
      `PFEE_${randomUUID().slice(0, 6).toUpperCase()}`,
      'AGENT',
      agent.id,
      'CASH_TO_CASH',
    );
    const phone = newPhone();

    const idem = `fee-12-${randomUUID()}`;
    const result = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '30000',
      currency: 'NGN',
      idempotencyKey: idem,
    });
    expect(result.status).toBe('COMPLETED');

    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    expect(snaps).toHaveLength(1);
    const fee = snaps[0].fee_decision;
    expect(fee.status).toBe('APPLIED');
    expect(fee.feeMinor).toBe('125');
    expect(fee.totalMinor).toBe('30125');
    expect(fee.posting).toEqual(POSTING_BLOCKED);
    // legacy flow evidence retained on top of the calculated decision
    expect(fee.agentId).toBe(agent.id);
    expect(fee.transferId).toBe(result.transferId);

    // journal UNCHANGED: DEBIT agent, CREDIT unclaimed, principal-only (this is the previously
    // dangerous totalString debit path — fee/vat stay 0 in the flow until provisioning)
    const lines = await journalLines(result.journalId);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('30000');
    const txRows = await dataSource.query(
      `SELECT fee_minor::text AS fee_minor, vat_minor::text AS vat_minor, principal_minor::text AS principal_minor FROM cash_to_cash_transfers WHERE id=$1`,
      [result.transferId],
    );
    expect(txRows[0].principal_minor).toBe('30000');
    expect(txRows[0].fee_minor).toBe('0');
    expect(txRows[0].vat_minor).toBe('0');
  });

  // ── 13. CASH_TO_CASH claim replication: bit-for-bit identical fee decision ──

  it('13. CASH_TO_CASH claim: replicated fee decision is identical to the initiation decision', async () => {
    await seedFeeRule({ productCode: 'CASH_TO_CASH', percentageBps: 100, priority: 0 }); // 1% provisional
    const { agent, wallet: agentWallet } = await createActiveAgentWithPin('1234');
    await fundAgent(agentWallet.ledgerAccountId, '200000');
    await seedCustomerLimitProfile(
      `PFEE_${randomUUID().slice(0, 6).toUpperCase()}`,
      'AGENT',
      agent.id,
      'CASH_TO_CASH',
    );
    const phone = newPhone();
    const init = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '20000',
      currency: 'NGN',
      idempotencyKey: `fee-13-init-${randomUUID()}`,
    });
    expect(init.status).toBe('COMPLETED');

    const { customerId } = await createCustomerWithPhone(phone);
    await seedCustomerLimitProfile(
      `PFEE_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'CASH_TO_CASH',
    );
    const otp = 'fee13-otp';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const claim = await claimService.execute({
      transferId: init.transferId,
      beneficiaryPhone: phone,
      transferCode: init.transferCode!,
      customerId,
      mfaChallengeId: challengeId,
      otp,
      idempotencyKey: `fee-13-claim-${randomUUID()}`,
    });
    expect(claim.status).toBe('COMPLETED');

    const initSnaps = await snapshotsFor(`journal_id = $1`, [init.journalId]);
    const claimSnaps = await snapshotsFor(`journal_id = $1`, [claim.journalId]);
    expect(initSnaps).toHaveLength(1);
    expect(claimSnaps).toHaveLength(1);
    const initFee = initSnaps[0].fee_decision;
    const claimFee = claimSnaps[0].fee_decision;
    // same computed numbers (1% of 20000 == 200)
    expect(initFee.status).toBe('APPLIED');
    expect(initFee.feeMinor).toBe('200');
    // replication is bit-for-bit on every identity/calculation key
    for (const k of [
      'status',
      'currency',
      'amountMinor',
      'feeMinor',
      'vatMinor',
      'totalMinor',
      'calculationModel',
      'flatFeeComponentMinor',
      'percentageFeeComponentMinor',
      'rawFeeMinor',
      'minimumApplied',
      'maximumApplied',
      'roundingApplied',
      'vatApplied',
      'vatRateBps',
      'vatBasisMinor',
      'ruleRefs',
      'posting',
    ]) {
      expect(claimFee[k]).toEqual(initFee[k]);
    }
    // claim journal remains principal-only
    const lines = await journalLines(claim.journalId);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('20000');
  });

  // ── 14. CUSTOMER_FUNDING FREE — fee 0, correct snapshot, no fee posting ──

  const supportMaker: any = {
    type: 'SUPPORT',
    principalId: `support-maker-${randomUUID().slice(0, 6)}`,
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const operatorChecker: any = {
    type: 'OPERATOR',
    principalId: `operator-checker-${randomUUID().slice(0, 6)}`,
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };

  async function createBasicCustomer(): Promise<string> {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-fee-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0].id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer FEE',true)`,
      [customerId],
    );
    return customerId;
  }

  it('14. CUSTOMER_FUNDING is FREE: no rule configured → fee 0, no fee legs, correct snapshot', async () => {
    const customerId = await createBasicCustomer();
    const wallet = await createWallet(customerId);
    await seedCustomerLimitProfile(
      `PFEE_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'CUSTOMER_FUNDING',
    );

    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '40000',
      currency: 'NGN',
      idempotencyKey: `fee-14-${randomUUID()}`,
      principal: supportMaker,
    });
    expect(created.status).toBe('PENDING');
    const approved = await fundingService.approve({
      fundingRequestId: created.id,
      principal: operatorChecker,
    });
    expect(approved.status).toBe('APPROVED');

    const snaps = await snapshotsFor(`journal_id = $1 AND product = $2`, [
      approved.journalId,
      'CUSTOMER_FUNDING',
    ]);
    expect(snaps).toHaveLength(1);
    const fee = snaps[0].fee_decision;
    expect(fee.status).toBe('NOT_CONFIGURED'); // FREE by policy: no production rule
    expect(fee.feeMinor).toBe('0');
    expect(fee.vatMinor).toBe('0');
    expect(fee.totalMinor).toBe('40000');

    // journal = settlement→customer principal only; wallet credited exactly the principal
    const lines = await journalLines(approved.journalId);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('40000');
    expect(await walletBalance(wallet.ledgerAccountId)).toBe(40000n);

    // even if someone configures an explicit zero rule for funding, the engine keeps it FREE
    await dataSource.query(`DELETE FROM fee_rules`); // scope: none configured for the FREE branches
    const customer2 = await createBasicCustomer();
    const wallet2 = await createWallet(customer2);
    await seedCustomerLimitProfile(
      `PFEE_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customer2,
      'CUSTOMER_FUNDING',
    );
    await seedFeeRule({ productCode: 'CUSTOMER_FUNDING', flatFeeMinor: '0' });
    const created2 = await fundingService.createRequest({
      customerId: customer2,
      amountMinor: '40000',
      currency: 'NGN',
      idempotencyKey: `fee-14z-${randomUUID()}`,
      principal: supportMaker,
    });
    const approved2 = await fundingService.approve({
      fundingRequestId: created2.id,
      principal: operatorChecker,
    });
    const snaps2 = await snapshotsFor(`journal_id = $1 AND product = $2`, [
      approved2.journalId,
      'CUSTOMER_FUNDING',
    ]);
    expect(snaps2[0].fee_decision.status).toBe('ZERO');
    expect(snaps2[0].fee_decision.feeMinor).toBe('0');
    expect(await walletBalance(wallet2.ledgerAccountId)).toBe(40000n); // still credited full principal
  });
});
