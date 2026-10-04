/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unsafe-argument */
// @ts-nocheck
/**
 * V1-COMMERCIAL-IMPLEMENTATION-02 — COMMISSION ENGINE RUNTIME WIRING (real PG).
 *
 * Proves, against real PostgreSQL and the REAL transaction services, that the commission
 * decision is now wired at runtime through the existing authority chain ONLY:
 *   CommissionRuleResolverService.resolveWithManager (read-only, in-transaction)
 *     → CommissionCalculator (pure deterministic BigInt mechanics)
 *     → CommissionEngine.decideWithManager (decision facade, snapshot-shaped)
 *     → Commercial Decision Snapshot (immutable record, SAME SERIALIZABLE transaction).
 *
 * Covered here (24 proofs):
 *   01–07 EMPTY registry → byte-identical NONE snapshots across all SEVEN V1 products
 *        (WALLET_TRANSFER, CASH_TO_WALLET, WALLET_TO_CASH, CASH_TO_CASH initiation + claim,
 *        CUSTOMER_FUNDING, AGENT_FUNDING + AGENT_DEFUNDING) — wiring cannot change behavior
 *        when nothing is configured; the C2C claim is deliberately engine-FREE.
 *   08–10 provisional policy (STANDARD 20% of the ACTUAL FEE) → ALLOCATED evidence-only
 *        decisions on WALLET_TO_CASH / CASH_TO_WALLET / CASH_TO_CASH initiation: beneficiary
 *        is the ACTING agent, payable=false, blockers recorded, posting.journalLegsPosted=false,
 *        feeCollectionState truthful, commissionEvent (TRANSACTION_COMPLETION /
 *        CASH_TO_CASH_INITIATION), journals stay principal-only.
 *   11   PREMIUM 30% class-targeted differentiation (STANDARD rule never matches PREMIUM).
 *   12   percentage FLOOR on odd fee amounts (fee 133 → 26) with explicit base evidence.
 *   13   ZERO products: WT / CUSTOMER_FUNDING / AGENT_FUNDING stay NONE while the three
 *        agent-mediated products carry rules (policy scoping).
 *   14   fee NOT_CONFIGURED + FEE-basis rule → explicit calculated ZERO allocation ('0'),
 *        feeCollectionState FEE_NOT_CONFIGURED (zero fee ⇒ zero commission, NEVER unavailable).
 *   15   AMBIGUOUS commission rules → fail-closed 409 BEFORE money commits (zero residue).
 *   16   AMBIGUOUS fee decision → fee basis unavailable → fail-closed 400 (zero residue).
 *   17   FEE basis = the authoritative FEE DECISION amount (never principal-derived).
 *   18   aggregatorId is never supplied at runtime → aggregator-targeted rules never match.
 *   19   rule versioning through flows (update → next snapshot carries ruleVersion 2).
 *   20   C2C initiation idempotent replay: one snapshot / one allocation / one balance move.
 *   21   ambiguous abort leaves nothing typed; disable the loser → recovery succeeds once.
 *   22   C2C product lifecycle: exactly ONE allocation across initiation + claim
 *        (claim is NOT a commission event — structural double-pay prevention).
 *   23   customer history invariant: projection exposes principal/fee/currency only;
 *        commission evidence NEVER leaks to the customer surface.
 *   24   financial isolation: no ledger account families invented, every journal strictly
 *        principal-only (2 legs), allocated commission amounts appear on NO ledger line.
 *
 * PROVISIONAL TEST CONFIGURATION ONLY — every fee/commission rule seeded here lives
 * exclusively inside this disposable per-process test database. These are NOT production
 * rates, NOT a pricing or commission policy, and are NEVER seeded into production data
 * (production registries stay EMPTY — commission-01 test 02).
 *
 * ACCOUNTING BOUNDARY (asserted, not assumed): ALLOCATED decisions are EVIDENCE ONLY:
 *   payable: false
 *   payableBlockers: [FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED, COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED]
 *   posting: { journalLegsPosted: false, reason: 'COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED' }
 * No ledger account codes were invented; the FEe basis amount is CALCULATED but never
 * COLLECTED; commission liability posting awaits an approved accounting policy.
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
import { WalletService } from '../src/wallet/wallet.service';
import { TransferService } from '../src/transfer/transfer.service';
import { LedgerService } from '../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { CommissionRuleRegistryService } from '../src/commission/commission-rule-registry.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { CustomerFundingService } from '../src/customer-funding/customer-funding.service';
import { CustomerTransactionHistoryService } from '../src/customer-app/customer-transaction-history.service';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashInService } from '../src/agent/agent-cash-in.service';
import { AgentCashOutService } from '../src/agent/agent-cash-out.service';
import { AgentCashToCashService } from '../src/agent/agent-cash-to-cash.service';
import { AgentCashToCashClaimService } from '../src/agent/agent-cash-to-cash-claim.service';
import { AgentFundingService } from '../src/agent/agent-funding.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
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

/** The exact accounting-boundary annotation an ALLOCATED decision must carry. */
const PAYABLE_BLOCKERS = [
  'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED',
  'COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED',
];
const COMMISSION_POSTING_BLOCKED = {
  journalLegsPosted: false,
  reason: 'COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED',
};

describe('V1-COMMERCIAL-IMPLEMENTATION-02 Commission runtime wiring (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let transferService: TransferService;
  let ledgerService: LedgerService;
  let feeRuleRegistry: FeeRuleRegistryService;
  let commissionRegistry: CommissionRuleRegistryService;
  let fundingService: CustomerFundingService;
  let historyService: CustomerTransactionHistoryService;
  let cashInService: AgentCashInService;
  let cashOutService: AgentCashOutService;
  let cashToCashService: AgentCashToCashService;
  let claimService: AgentCashToCashClaimService;
  let agentFundingService: AgentFundingService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let customerPinService: CustomerTransactionPinService;
  let mfaService: MfaExecutionService;

  let systemLedgerAccountId: string;
  let poolAccountId: string;

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
  const privilegedPrincipal: any = {
    type: 'PRIVILEGED',
    principalId: `priv-c02-${randomUUID().slice(0, 6)}`,
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-commission-runtime-02');
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
    await (app.getHttpAdapter().getInstance() as any).ready();
    walletService = app.get(WalletService);
    transferService = app.get(TransferService);
    ledgerService = app.get(LedgerService);
    feeRuleRegistry = app.get(FeeRuleRegistryService);
    commissionRegistry = app.get(CommissionRuleRegistryService);
    fundingService = app.get(CustomerFundingService);
    historyService = app.get(CustomerTransactionHistoryService);
    cashInService = app.get(AgentCashInService);
    cashOutService = app.get(AgentCashOutService);
    cashToCashService = app.get(AgentCashToCashService);
    claimService = app.get(AgentCashToCashClaimService);
    agentFundingService = app.get(AgentFundingService);
    classService = app.get(AgentClassService);
    appService = app.get(AgentApplicationService);
    lifecycleService = app.get(AgentLifecycleService);
    pinService = app.get(AgentAuthenticationService);
    customerPinService = app.get(CustomerTransactionPinService);
    mfaService = app.get(MfaExecutionService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await app.get(ProductCatalogSeedService).seedIfEmpty();
    // Infrastructure ledger accounts (system float + cash-to-cash unclaimed liability) — these
    // are seed/test fixture accounts, NOT fee-revenue or commission accounts (none exist).
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
    // Agent funding float pool (migration-seeded in production; same shape defensively here).
    await dataSource.query(`
      INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
      VALUES (gen_random_uuid(),'AGENT_FUNDING_POOL-NGN','Agent Funding Pool NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE)
      ON CONFLICT (code) DO NOTHING
    `);
    const poolRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_accounts WHERE code='AGENT_FUNDING_POOL-NGN' LIMIT 1`,
    );
    poolAccountId = poolRows[0]!.id;
  });

  // ── harness helpers (synthetic test data only) ──

  /** Provisional TEST-ONLY fee rule (gives the FEE basis an authoritative fee DECISION amount). */
  async function seedFeeRule(input: {
    productCode: string;
    flatFeeMinor?: string | null;
    percentageBps?: number | null;
    effectiveFrom?: Date;
    priority?: number;
  }): Promise<string> {
    const rule = await feeRuleRegistry.createRule(
      {
        productCode: input.productCode,
        currency: 'NGN',
        flatFeeMinor: input.flatFeeMinor ?? null,
        percentageBps: input.percentageBps ?? null,
        minimumFeeMinor: null,
        maximumFeeMinor: null,
        vatBps: null,
        effectiveFrom: input.effectiveFrom ?? new Date(Date.now() - 86400000),
        priority: input.priority ?? 0,
        isActive: true,
      },
      'test',
    );
    return rule.id;
  }

  /** Provisional TEST-ONLY commission rule (FEE basis, PERCENTAGE model — the 02 test policy). */
  async function seedCommissionRule(input: {
    productCode: string;
    percentageBps?: number;
    flatCommissionMinor?: string | null;
    calculationModel?: string;
    calculationBasis?: string;
    recipientType?: string;
    agentClassId?: string | null;
    aggregatorId?: string | null;
    priority?: number;
    effectiveFrom?: Date;
  }): Promise<string> {
    const rule = await commissionRegistry.createRule(
      {
        productCode: input.productCode,
        currency: 'NGN',
        recipientType: input.recipientType ?? 'AGENT',
        calculationModel: input.calculationModel ?? 'PERCENTAGE',
        calculationBasis: input.calculationBasis ?? 'FEE',
        flatCommissionMinor:
          input.flatCommissionMinor === undefined ? null : input.flatCommissionMinor,
        percentageBps: input.percentageBps ?? null,
        minimumCommissionMinor: null,
        maximumCommissionMinor: null,
        tiers: null,
        agentClassId: input.agentClassId ?? null,
        agentId: null, // individual agent overrides are DISABLED in V1 — never seeded
        aggregatorId: input.aggregatorId ?? null,
        effectiveFrom: input.effectiveFrom ?? new Date(Date.now() - 86400000),
        effectiveTo: null,
        priority: input.priority ?? 0,
        isActive: true,
      } as any,
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
    return { id: view.id, ledgerAccountId: rows[0]!.ledger_account_id };
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

  /** Limit profile + assignment + MIN/DAILY rules for the given subject + product. */
  async function seedLimitProfile(
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
    for (const [dimension, value] of [
      ['MIN_AMOUNT_PER_TX', '100'],
      ['DAILY_AMOUNT', '100000000'],
    ]) {
      await dataSource.query(
        `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, effective_to, is_active, created_by)
         VALUES ($1,$2,$3,NULL,NULL,'NGN',$4,$5,NULL,$6,NULL,true,'test')`,
        [randomUUID(), code, product, dimension, value, new Date(Date.now() - 86400000).toISOString()],
      );
    }
  }

  async function createActiveAgentWithPin(services: unknown, pin: string | null) {
    const cls = await classService.create({
      reference: `cls-c02-${randomUUID().slice(0, 8)}`,
      code: `CC02-${randomUUID().slice(0, 6)}`,
      name: 'C02 Class',
      isActive: true,
      applicableServices: services,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz C02 ${randomUUID().slice(0, 4)}`,
      contactEmail: `c02-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-c02',
    });
    await appService.submit(appEntity.id, 'applicant-c02');
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
      [`cust-c02-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer C02',true)`,
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
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    return { customerId, wallet, walletLedgerAccountId: rows[0]!.ledger_account_id };
  }

  async function createCustomerWithPhoneAndPin(phoneCanonical: string, pin: string) {
    const base = await createCustomerWithPhone(phoneCanonical);
    await customerPinService.setTransactionPin(base.customerId, {
      pinHash: hashPin(pin),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: base.customerId,
    });
    return base;
  }

  async function createMfaChallenge(customerId: string, otp: string, ttlSeconds = 300) {
    const eRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO mfa_enrollments (id, customer_id, reference, status) VALUES ($1,$2,$3,'ENABLED') RETURNING id`,
      [randomUUID(), customerId, `mfa-enroll-${randomUUID().slice(0, 6)}`],
    );
    const enrollmentId = eRows[0]!.id;
    const mRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
      [randomUUID(), customerId, enrollmentId, `mfa-method-${randomUUID().slice(0, 6)}`],
    );
    const methodId = mRows[0]!.id;
    const cRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customer_authentication_credentials (id, customer_id, credential_type, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PASSWORD','dummyhash','PBKDF2',1,NOW(),'ACTIVE') RETURNING id`,
      [randomUUID(), customerId],
    );
    const credentialId = cRows[0]!.id;
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

  async function createBasicCustomer(): Promise<string> {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-c02-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer C02',true)`,
      [customerId],
    );
    return customerId;
  }

  async function createAggregator(): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO aggregators (id, reference, code, corporate_name, status, created_by, version) VALUES ($1,$2,$3,'C02 Aggregator Ltd','ACTIVE','c02-test',1)`,
      [id, `agg-c02-${randomUUID().slice(0, 8)}`, `AGC-${randomUUID().slice(0, 6)}`],
    );
    return id;
  }

  /** Cash-in (CASH_TO_WALLET) run to completion; needs agent CASH_IN + customer phone. */
  async function runCashIn(input: {
    amountMinor?: string;
    key?: string;
    agentBundle?: Awaited<ReturnType<typeof createActiveAgentWithPin>>;
  }): Promise<{
    agent: any;
    cls: any;
    agentWallet: any;
    customerId: string;
    custWalletLedgerId: string;
    result: any;
  }> {
    const bundle =
      input.agentBundle ?? (await createActiveAgentWithPin([AgentService.CASH_IN], '1234'));
    const { agent, cls, wallet: agentWallet } = bundle;
    await fundAgent(agentWallet.ledgerAccountId, '500000');
    const phone = newPhone();
    const { customerId, walletLedgerAccountId: custWalletLedgerId } =
      await createCustomerWithPhone(phone);
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'CASH_TO_WALLET',
    );
    const result = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: input.amountMinor ?? '30000',
      currency: 'NGN',
      idempotencyKey: input.key ?? `c02-in-${randomUUID()}`,
      reference: `ref-c02-${randomUUID()}`,
    });
    return { agent, cls, agentWallet, customerId, custWalletLedgerId, result };
  }

  /** Cash-out (WALLET_TO_CASH) run to completion; needs a funded customer wallet + MFA. */
  async function runCashOut(input: {
    services?: unknown;
    amountMinor?: string;
    key?: string;
    agentBundle?: Awaited<ReturnType<typeof createActiveAgentWithPin>>;
  }): Promise<{
    agent: any;
    cls: any;
    customerId: string;
    custWalletLedgerId: string;
    result: any;
  }> {
    const bundle =
      input.agentBundle ?? (await createActiveAgentWithPin([AgentService.CASH_OUT], '1234'));
    const { agent, cls } = bundle;
    const phone = newPhone();
    const { customerId, walletLedgerAccountId: custWalletLedgerId } =
      await createCustomerWithPhoneAndPin(phone, '1234');
    await fundWallet(custWalletLedgerId, '500000');
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'WALLET_TO_CASH',
    );
    const otp = 'c02-otp';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const result = await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp,
      amountMinor: input.amountMinor ?? '30000',
      currency: 'NGN',
      idempotencyKey: input.key ?? `c02-out-${randomUUID()}`,
    });
    return { agent, cls, customerId, custWalletLedgerId, result };
  }

  /** CASH_TO_CASH initiation run to completion (agent-funded, unclaimed liability credited). */
  async function runC2cInitiation(input: {
    amountMinor?: string;
    key?: string;
    phone?: string;
    agentBundle?: Awaited<ReturnType<typeof createActiveAgentWithPin>>;
  }): Promise<{ agent: any; cls: any; phone: string; result: any }> {
    const bundle =
      input.agentBundle ?? (await createActiveAgentWithPin([AgentService.CASH_TO_CASH], '1234'));
    const { agent, cls, wallet: agentWallet } = bundle;
    await fundAgent(agentWallet.ledgerAccountId, '500000');
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'AGENT',
      agent.id,
      'CASH_TO_CASH',
    );
    const phone = input.phone ?? newPhone();
    const result = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: input.amountMinor ?? '30000',
      currency: 'NGN',
      idempotencyKey: input.key ?? `c02-c2c-${randomUUID()}`,
    });
    return { agent, cls, phone, result };
  }

  /** Claim an initiated CASH_TO_CASH transfer as the beneficiary customer. */
  async function runClaim(initResult: any, phone: string): Promise<any> {
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'CASH_TO_CASH',
    );
    const otp = 'c02-claim-otp';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const claim = await claimService.execute({
      transferId: initResult.transferId,
      beneficiaryPhone: phone,
      transferCode: initResult.transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp,
      idempotencyKey: `c02-claim-${randomUUID()}`,
    });
    expect(claim.status).toBe('COMPLETED');
    return claim;
  }

  /** Standard evidence assertions for an ALLOCATED agent allocation. */
  function expectAllocatedBoundary(
    commission: any,
    expected: {
      amountMinor: string;
      baseAmountMinor: string;
      feeCollectionState: string;
      commissionEvent: string;
    },
  ) {
    expect(commission.status).toBe('ALLOCATED');
    expect(commission.payable).toBe(false);
    expect(commission.payableBlockers).toEqual(PAYABLE_BLOCKERS);
    expect(commission.posting).toEqual(COMMISSION_POSTING_BLOCKED);
    expect(commission.feeCollectionState).toBe(expected.feeCollectionState);
    expect(commission.commissionEvent).toBe(expected.commissionEvent);
    expect(commission.allocations).toHaveLength(1);
    const alloc = commission.allocations[0];
    expect(alloc.beneficiaryType).toBe('AGENT');
    expect(alloc.amountMinor).toBe(expected.amountMinor);
    expect(alloc.currency).toBe('NGN');
    expect(alloc.basis).toBe('FEE');
    expect(alloc.baseAmountMinor).toBe(expected.baseAmountMinor);
    expect(alloc.calculationModel).toBe('PERCENTAGE');
    expect(alloc.ruleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(alloc.ruleVersion).toBeGreaterThanOrEqual(1);
    expect(commission.ruleRefs).toHaveLength(1);
    expect(commission.ruleRefs[0].ruleId).toBe(alloc.ruleId);
    expect(commission.ruleRefs[0].ruleVersion).toBe(alloc.ruleVersion);
    expect(commission.ruleRefs[0].ruleType).toBe('COMMISSION');
    return alloc;
  }

  /** The byte-identical pre-wiring NONE shape (commissionNone()). */
  const NONE_SHAPE = { status: 'NONE', allocations: [], ruleRefs: [] };

  // ══════════════════════════════════════════════════════════════════
  // GROUP A — EMPTY registry: wiring must be byte-inert
  // ══════════════════════════════════════════════════════════════════

  it('01. WALLET_TRANSFER, EMPTY registry → byte-identical NONE commission snapshot', async () => {
    const customerA = randomUUID();
    const wA = await createWallet(customerA);
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');
    const res = await tryTransfer(wA.id, wB.id, '21000', `c02-01-${randomUUID()}`);
    expect(res.success).toBe(true);
    const snaps = await snapshotsFor(`journal_id = $1`, [res.view.journalId]);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].product).toBe('WALLET_TRANSFER');
    expect(snaps[0].commission_decision).toEqual(NONE_SHAPE);
    const lines = await journalLines(res.view.journalId);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('21000');
  });

  it('02. CASH_TO_WALLET, EMPTY registry → byte-identical NONE', async () => {
    const { result } = await runCashIn({});
    expect(result.status).toBe('COMPLETED');
    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].product).toBe('CASH_TO_WALLET');
    expect(snaps[0].commission_decision).toEqual(NONE_SHAPE);
  });

  it('03. WALLET_TO_CASH, EMPTY registry → byte-identical NONE', async () => {
    const { result } = await runCashOut({});
    expect(result.status).toBe('COMPLETED');
    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].product).toBe('WALLET_TO_CASH');
    expect(snaps[0].commission_decision).toEqual(NONE_SHAPE);
  });

  it('04. CASH_TO_CASH initiation, EMPTY registry → byte-identical NONE', async () => {
    const { result } = await runC2cInitiation({});
    expect(result.status).toBe('COMPLETED');
    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].product).toBe('CASH_TO_CASH');
    expect(snaps[0].commission_decision).toEqual(NONE_SHAPE);
    // no commissionEvent is ever annotated on a NONE decision (annotation only wraps ALLOCATED)
    expect(snaps[0].commission_decision.commissionEvent).toBeUndefined();
  });

  it('05. CASH_TO_CASH CLAIM, EMPTY registry → byte-identical NONE (claim is engine-free)', async () => {
    const { result, phone } = await runC2cInitiation({});
    const claim = await runClaim(result, phone);
    const initSnaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    const claimSnaps = await snapshotsFor(`journal_id = $1`, [claim.journalId]);
    expect(initSnaps).toHaveLength(1);
    expect(claimSnaps).toHaveLength(1);
    expect(initSnaps[0].commission_decision).toEqual(NONE_SHAPE);
    expect(claimSnaps[0].commission_decision).toEqual(NONE_SHAPE);
  });

  it('06. CUSTOMER_FUNDING, EMPTY registry → byte-identical NONE', async () => {
    const customerId = await createBasicCustomer();
    await createWallet(customerId);
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'CUSTOMER_FUNDING',
    );
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '40000',
      currency: 'NGN',
      idempotencyKey: `c02-06-${randomUUID()}`,
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
    expect(snaps[0].commission_decision).toEqual(NONE_SHAPE);
  });

  it('07. AGENT_FUNDING + AGENT_DEFUNDING, EMPTY registry → byte-identical NONE', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithPin(
      ['AGENT_FUNDING', 'AGENT_DEFUNDING'] as any,
      null,
    );
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'AGENT',
      agent.id,
      'AGENT_FUNDING',
    );
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'AGENT',
      agent.id,
      'AGENT_DEFUNDING',
    );
    const fundRes = await agentFundingService.fund({
      agentId: agent.id,
      amountMinor: '30000',
      currency: 'NGN',
      idempotencyKey: `c02-07f-${randomUUID()}`,
      principal: privilegedPrincipal,
      actor: 'test-actor',
    });
    expect(fundRes.status).toBe('COMPLETED');
    const defundRes = await agentFundingService.defund({
      agentId: agent.id,
      amountMinor: '5000',
      currency: 'NGN',
      idempotencyKey: `c02-07d-${randomUUID()}`,
      principal: privilegedPrincipal,
      actor: 'test-actor',
    });
    expect(defundRes.status).toBe('COMPLETED');
    const fundSnaps = await snapshotsFor(`journal_id = $1`, [fundRes.journalId]);
    const defundSnaps = await snapshotsFor(`journal_id = $1`, [defundRes.journalId]);
    expect(fundSnaps).toHaveLength(1);
    expect(defundSnaps).toHaveLength(1);
    expect(fundSnaps[0].product).toBe('AGENT_FUNDING');
    expect(defundSnaps[0].product).toBe('AGENT_DEFUNDING');
    expect(fundSnaps[0].commission_decision).toEqual(NONE_SHAPE);
    expect(defundSnaps[0].commission_decision).toEqual(NONE_SHAPE);
    // pool accounting used the migration-seeded pool identity — unchanged by this task
    expect(poolAccountId).toMatch(/^[0-9a-f-]{36}$/);
    expect(agentWallet).toBeDefined();
  });

  // ══════════════════════════════════════════════════════════════════
  // GROUP B — provisional policy: ALLOCATED, evidence-only
  // ══════════════════════════════════════════════════════════════════

  it('08. WALLET_TO_CASH STANDARD (20% of actual fee 250) → ALLOCATED 50 to the ACTING agent, evidence-only', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234');
    const commRuleId = await seedCommissionRule({
      productCode: 'WALLET_TO_CASH',
      percentageBps: 2000,
      agentClassId: bundle.cls.id,
      effectiveFrom: new Date(Date.now() - 86400000),
    });
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '250' });
    const { agent, custWalletLedgerId, result } = await runCashOut({ agentBundle: bundle });
    expect(result.status).toBe('COMPLETED');

    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].fee_decision.feeMinor).toBe('250');
    const alloc = expectAllocatedBoundary(snaps[0].commission_decision, {
      amountMinor: '50', // floor(250 * 2000 / 10000)
      baseAmountMinor: '250',
      feeCollectionState: 'FEE_CALCULATED_NOT_COLLECTED',
      commissionEvent: 'TRANSACTION_COMPLETION',
    });
    expect(alloc.beneficiaryId).toBe(agent.id); // acting agent is the beneficiary
    expect(alloc.targeting.agentClassId).toBe(bundle.cls.id);
    // journals stay strictly principal-only: 30000 debited from customer, credited to agent
    const lines = await journalLines(result.journalId);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('30000');
    expect(await walletBalance(custWalletLedgerId)).toBe(500000n - 30000n);
    // the commission evidence references the provisionally configured rule, version 1
    expect(snaps[0].commission_decision.ruleRefs[0].ruleId).toBe(commRuleId);
  });

  it('09. CASH_TO_WALLET STANDARD (20% of actual fee 250) → ALLOCATED 50, evidence-only, journal principal-only', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 2000,
      agentClassId: bundle.cls.id,
    });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '250' });
    const { agent, custWalletLedgerId, result } = await runCashIn({ agentBundle: bundle });
    expect(result.status).toBe('COMPLETED');

    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    expect(snaps).toHaveLength(1);
    const alloc = expectAllocatedBoundary(snaps[0].commission_decision, {
      amountMinor: '50',
      baseAmountMinor: '250',
      feeCollectionState: 'FEE_CALCULATED_NOT_COLLECTED',
      commissionEvent: 'TRANSACTION_COMPLETION',
    });
    expect(alloc.beneficiaryId).toBe(agent.id);
    const lines = await journalLines(result.journalId);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('30000');
    expect(await walletBalance(custWalletLedgerId)).toBe(30000n);
  });

  it('10. CASH_TO_CASH initiation STANDARD (20% of actual fee 250) → ALLOCATED 50 at the single INITIATION event', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_TO_CASH], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_CASH',
      percentageBps: 2000,
      agentClassId: bundle.cls.id,
    });
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '250' });
    const { agent, result } = await runC2cInitiation({ agentBundle: bundle });
    expect(result.status).toBe('COMPLETED');

    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    expect(snaps).toHaveLength(1);
    const alloc = expectAllocatedBoundary(snaps[0].commission_decision, {
      amountMinor: '50',
      baseAmountMinor: '250',
      feeCollectionState: 'FEE_CALCULATED_NOT_COLLECTED',
      commissionEvent: 'CASH_TO_CASH_INITIATION', // the single commission lifecycle event
    });
    expect(alloc.beneficiaryId).toBe(agent.id);
    const lines = await journalLines(result.journalId);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('30000'); // DEBIT agent, CREDIT unclaimed
    const txRows: Array<{ fee_minor: string }> = await dataSource.query(
      `SELECT fee_minor::text AS fee_minor FROM cash_to_cash_transfers WHERE id=$1`,
      [result.transferId],
    );
    expect(txRows[0]!.fee_minor).toBe('0'); // persisted fee slot untouched (decision-only)
  });

  it('11. PREMIUM class (30% of fee) beats nothing: class-differentiated rates, STANDARD rule never matches PREMIUM agent', async () => {
    const standard = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234');
    const premium = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234');
    const standardRuleId = await seedCommissionRule({
      productCode: 'WALLET_TO_CASH',
      percentageBps: 2000,
      agentClassId: standard.cls.id,
      effectiveFrom: new Date(Date.now() - 86400000),
    });
    const premiumRuleId = await seedCommissionRule({
      productCode: 'WALLET_TO_CASH',
      percentageBps: 3000,
      agentClassId: premium.cls.id,
      effectiveFrom: new Date(Date.now() - 86399000),
    });
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '250' });

    const premiumRun = await runCashOut({ agentBundle: premium });
    const premiumSnaps = await snapshotsFor(`journal_id = $1`, [premiumRun.result.journalId]);
    const premiumAlloc = expectAllocatedBoundary(premiumSnaps[0].commission_decision, {
      amountMinor: '75', // floor(250 * 3000 / 10000)
      baseAmountMinor: '250',
      feeCollectionState: 'FEE_CALCULATED_NOT_COLLECTED',
      commissionEvent: 'TRANSACTION_COMPLETION',
    });
    expect(premiumAlloc.ruleId).toBe(premiumRuleId);
    expect(premiumAlloc.ruleId).not.toBe(standardRuleId);
    expect(premiumAlloc.beneficiaryId).toBe(premiumRun.agent.id);

    const standardRun = await runCashOut({ agentBundle: standard });
    const standardSnaps = await snapshotsFor(`journal_id = $1`, [standardRun.result.journalId]);
    const standardAlloc = expectAllocatedBoundary(standardSnaps[0].commission_decision, {
      amountMinor: '50',
      baseAmountMinor: '250',
      feeCollectionState: 'FEE_CALCULATED_NOT_COLLECTED',
      commissionEvent: 'TRANSACTION_COMPLETION',
    });
    expect(standardAlloc.ruleId).toBe(standardRuleId);
    expect(standardAlloc.beneficiaryId).toBe(standardRun.agent.id);
    // proven: two distinct class-targeted rates resolved class-by-class, fresh, in-transaction
  });

  it('12. percentage FLOOR on the FEE basis: fee 133 → commission 26 with explicit base evidence', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 2000,
      agentClassId: bundle.cls.id,
    });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '133' });
    const { result } = await runCashIn({ agentBundle: bundle });
    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    expect(snaps[0].fee_decision.feeMinor).toBe('133');
    expectAllocatedBoundary(snaps[0].commission_decision, {
      amountMinor: '26', // floor(133 * 2000 / 10000) = floor(26.6)
      baseAmountMinor: '133',
      feeCollectionState: 'FEE_CALCULATED_NOT_COLLECTED',
      commissionEvent: 'TRANSACTION_COMPLETION',
    });
  });

  it('13. ZERO products: WALLET_TRANSFER / CUSTOMER_FUNDING / AGENT_FUNDING stay NONE while the three agent-mediated products carry rules', async () => {
    // provisional policy targets ONLY W2C / C2W / C2C
    for (const productCode of ['WALLET_TO_CASH', 'CASH_TO_WALLET', 'CASH_TO_CASH']) {
      await seedCommissionRule({ productCode, percentageBps: 2000 });
      await seedFeeRule({ productCode, flatFeeMinor: '250' });
    }
    // WALLET_TRANSFER: no commission rule exists for it → engine answer is empty → NONE
    const wA = await createWallet(randomUUID());
    const wB = await createWallet(randomUUID());
    await fundWallet(wA.ledgerAccountId, '100000');
    const tx = await tryTransfer(wA.id, wB.id, '21000', `c02-13t-${randomUUID()}`);
    expect(tx.success).toBe(true);
    expect((await snapshotsFor(`journal_id = $1`, [tx.view.journalId]))[0].commission_decision).toEqual(NONE_SHAPE);

    // CUSTOMER_FUNDING: no rule → NONE (decision evidence still recorded atomically)
    const customerId = await createBasicCustomer();
    await createWallet(customerId);
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'CUSTOMER_FUNDING',
    );
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '40000',
      currency: 'NGN',
      idempotencyKey: `c02-13f-${randomUUID()}`,
      principal: supportMaker,
    });
    const approved = await fundingService.approve({
      fundingRequestId: created.id,
      principal: operatorChecker,
    });
    expect(
      (await snapshotsFor(`journal_id = $1`, [approved.journalId]))[0].commission_decision,
    ).toEqual(NONE_SHAPE);

    // AGENT_FUNDING: no rule → NONE even though this service KNOWS the funded agent
    const { agent } = await createActiveAgentWithPin(['AGENT_FUNDING', 'AGENT_DEFUNDING'] as any, null);
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'AGENT',
      agent.id,
      'AGENT_FUNDING',
    );
    const funded = await agentFundingService.fund({
      agentId: agent.id,
      amountMinor: '10000',
      currency: 'NGN',
      idempotencyKey: `c02-13a-${randomUUID()}`,
      principal: privilegedPrincipal,
      actor: 'test-actor',
    });
    expect(
      (await snapshotsFor(`journal_id = $1`, [funded.journalId]))[0].commission_decision,
    ).toEqual(NONE_SHAPE);
  });

  it('14. fee NOT_CONFIGURED + FEE-basis rule → explicit calculated ZERO allocation (zero fee ⇒ zero commission, NEVER unavailable)', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 2000,
      agentClassId: bundle.cls.id,
    });
    // NO fee rule: the fee decision is honest NOT_CONFIGURED; the fee basis resolves to '0'
    // (never fabricated, and NEVER "unavailable" — an explicit calculated zero).
    const { agent, result } = await runCashIn({ agentBundle: bundle });
    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].fee_decision.status).toBe('NOT_CONFIGURED');
    const alloc = expectAllocatedBoundary(snaps[0].commission_decision, {
      amountMinor: '0', // floor('0' * 2000 / 10000)
      baseAmountMinor: '0',
      feeCollectionState: 'FEE_NOT_CONFIGURED',
      commissionEvent: 'TRANSACTION_COMPLETION',
    });
    expect(alloc.beneficiaryId).toBe(agent.id);
  });

  it('15. AMBIGUOUS commission rules → fail-closed 409 BEFORE money commits (no snapshot, no journal, no balance change)', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    // two equally-applicable untargeted AGENT rules sharing the top priority — ambiguity by design
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 2000,
      priority: 5,
      effectiveFrom: new Date(Date.now() - 86400000),
    });
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 3000,
      priority: 5,
      effectiveFrom: new Date(Date.now() - 86399000),
    });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '250' });

    const { agent, cls, wallet: agentWallet } = bundle;
    await fundAgent(agentWallet.ledgerAccountId, '500000');
    const phone = newPhone();
    const { customerId } = await createCustomerWithPhone(phone);
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'CASH_TO_WALLET',
    );
    const balanceBefore = await walletBalance(agentWallet.ledgerAccountId);
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '30000',
        currency: 'NGN',
        idempotencyKey: `c02-15-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('COMMISSION_RULE_AMBIGUOUS') });
    // NOTHING committed: money, journal, snapshot all absent (SERIALIZABLE rollback)
    expect((await dataSource.query(`SELECT count(*)::text AS cnt FROM commercial_decision_snapshots`))[0].cnt).toBe('0');
    expect((await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`))[0].cnt).toBe('1'); // only the float-fund fixture journal
    expect(await walletBalance(agentWallet.ledgerAccountId)).toBe(balanceBefore);
    expect(cls).toBeDefined();
  });

  it('16. AMBIGUOUS fee decision → FEE basis unavailable → fail-closed 400 COMMISSION_BASE_UNAVAILABLE (no residue)', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 2000,
      agentClassId: bundle.cls.id,
    });
    // two same-priority fee rules → the fee decision is AMBIGUOUS; the commission engine must
    // refuse to infer a base from it (never guesses on an ambiguous fee).
    await seedFeeRule({
      productCode: 'CASH_TO_WALLET',
      flatFeeMinor: '100',
      priority: 5,
      effectiveFrom: new Date(Date.now() - 86400000),
    });
    await seedFeeRule({
      productCode: 'CASH_TO_WALLET',
      flatFeeMinor: '200',
      priority: 5,
      effectiveFrom: new Date(Date.now() - 86399000),
    });
    const { agent, wallet: agentWallet } = bundle;
    await fundAgent(agentWallet.ledgerAccountId, '500000');
    const phone = newPhone();
    const { customerId } = await createCustomerWithPhone(phone);
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'CASH_TO_WALLET',
    );
    const balanceBefore = await walletBalance(agentWallet.ledgerAccountId);
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '30000',
        currency: 'NGN',
        idempotencyKey: `c02-16-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('COMMISSION_BASE_UNAVAILABLE') });
    expect((await dataSource.query(`SELECT count(*)::text AS cnt FROM commercial_decision_snapshots`))[0].cnt).toBe('0');
    expect(await walletBalance(agentWallet.ledgerAccountId)).toBe(balanceBefore);
  });

  it('17. FEE basis is the authoritative FEE DECISION amount — never principal-derived (0.5% fee of 30000 → base 150 → commission 30)', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 2000, // 20% of the FEE
      agentClassId: bundle.cls.id,
    });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', percentageBps: 50 }); // 0.5% of principal
    const { result } = await runCashIn({ agentBundle: bundle });
    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    expect(snaps[0].fee_decision.feeMinor).toBe('150'); // 0.5% of 30000
    expectAllocatedBoundary(snaps[0].commission_decision, {
      amountMinor: '30', // floor(150 * 2000 / 10000) — NOT 6000 (20% of principal)
      baseAmountMinor: '150',
      feeCollectionState: 'FEE_CALCULATED_NOT_COLLECTED',
      commissionEvent: 'TRANSACTION_COMPLETION',
    });
    // the recorded base equals the authoritative fee decision amount byte-for-byte
    expect(snaps[0].commission_decision.allocations[0].baseAmountMinor).toBe(
      snaps[0].fee_decision.feeMinor,
    );
  });

  it('18. aggregatorId is never supplied at runtime → aggregator-targeted rules never match; only the AGENT allocation exists', async () => {
    const aggId = await createAggregator();
    const bundle = await createActiveAgentWithPin([AgentService.CASH_TO_CASH], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_CASH',
      percentageBps: 2000,
      agentClassId: bundle.cls.id,
    });
    await seedCommissionRule({
      productCode: 'CASH_TO_CASH',
      recipientType: 'AGGREGATOR',
      percentageBps: 5000,
      aggregatorId: aggId,
      effectiveFrom: new Date(Date.now() - 86399000),
    });
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '250' });
    const { result } = await runC2cInitiation({ agentBundle: bundle });
    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    const commission = snaps[0].commission_decision;
    expect(commission.status).toBe('ALLOCATED');
    expect(commission.allocations).toHaveLength(1); // AGENT only
    expect(commission.allocations[0].beneficiaryType).toBe('AGENT');
    expect(commission.allocations.map((a: any) => a.beneficiaryType)).not.toContain('AGGREGATOR');
    expect(commission.ruleRefs).toHaveLength(1);
  });

  it('19. rule versioning flows through: updateRule bumps resolve the NEW version; a stale write 409s', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    const commRuleId = await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 2000,
      agentClassId: bundle.cls.id,
    });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '250' });

    const first = await runCashIn({ agentBundle: bundle });
    const firstSnaps = await snapshotsFor(`journal_id = $1`, [first.result.journalId]);
    expect(firstSnaps[0].commission_decision.allocations[0].ruleVersion).toBe(1);
    expect(firstSnaps[0].commission_decision.allocations[0].amountMinor).toBe('50');

    // operator update (optimistic lock): STANDARD 20% → 30%
    const rows: Array<{ version: number }> = await dataSource.query(
      `SELECT version FROM commission_rules WHERE id=$1`,
      [commRuleId],
    );
    const updated = await commissionRegistry.updateRule(
      commRuleId,
      { percentageBps: 3000, version: rows[0]!.version } as any,
      'test',
    );
    expect(updated.version).toBe(2);
    await expect(
      commissionRegistry.updateRule(commRuleId, { percentageBps: 500, version: 1 } as any, 'test'),
    ).rejects.toMatchObject({ status: 409 });

    const second = await runCashIn({ agentBundle: bundle });
    const secondSnaps = await snapshotsFor(`journal_id = $1`, [second.result.journalId]);
    expect(secondSnaps[0].commission_decision.allocations[0].ruleVersion).toBe(2);
    expect(secondSnaps[0].commission_decision.allocations[0].amountMinor).toBe('75'); // floor(250 * 3000/10000)
    expect(secondSnaps[0].commission_decision.ruleRefs[0].ruleVersion).toBe(2);
  });

  it('20. C2C initiation idempotent replay: exactly ONE snapshot / ONE allocation / ONE balance movement', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_TO_CASH], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_CASH',
      percentageBps: 2000,
      agentClassId: bundle.cls.id,
    });
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '250' });
    const { agent, wallet: agentWallet } = bundle;
    await fundAgent(agentWallet.ledgerAccountId, '500000');
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'AGENT',
      agent.id,
      'CASH_TO_CASH',
    );
    const phone = newPhone();
    const key = `c02-20-${randomUUID()}`;
    const payload = {
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '30000',
      currency: 'NGN',
      idempotencyKey: key,
    };
    const first = await cashToCashService.execute(payload);
    expect(first.status).toBe('COMPLETED');
    const replay = await cashToCashService.execute(payload);
    expect(replay.status).toBe('REPLAYED');
    expect(replay.transferId).toBe(first.transferId);
    expect(replay.journalId).toBe(first.journalId);

    const snaps = await snapshotsFor(`journal_id = $1`, [first.journalId]);
    expect(snaps).toHaveLength(1); // not duplicated
    expect(snaps[0].commission_decision.allocations).toHaveLength(1);
    expect(snaps[0].commission_decision.allocations[0].amountMinor).toBe('50');
    const txRows: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text AS cnt FROM cash_to_cash_transfers WHERE idempotency_key=$1`,
      [key],
    );
    expect(txRows[0]!.cnt).toBe('1');
    expect(await walletBalance(agentWallet.ledgerAccountId)).toBe(500000n - 30000n); // debited ONCE
  });

  it('21. ambiguous rule leaves NOTHING written; demote the loser → recovery succeeds with the surviving rate', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    const loserId = await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 3000,
      priority: 5,
      effectiveFrom: new Date(Date.now() - 86400000),
    });
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 2000,
      priority: 5,
      agentClassId: bundle.cls.id,
      effectiveFrom: new Date(Date.now() - 86399000),
    });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '250' });

    // attempt 1 must fail closed (both untargeted + class-targeted apply to THIS agent at priority 5)
    const { agent, wallet: agentWallet } = bundle;
    await fundAgent(agentWallet.ledgerAccountId, '500000');
    const phone = newPhone();
    const { customerId } = await createCustomerWithPhone(phone);
    await seedLimitProfile(
      `PC02_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'CASH_TO_WALLET',
    );
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '30000',
        currency: 'NGN',
        idempotencyKey: `c02-21-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await dataSource.query(`SELECT count(*)::text AS cnt FROM commercial_decision_snapshots`))[0].cnt,
    ).toBe('0');

    // fix configuration → the SAME agent flow now succeeds with the surviving 20% (2000bps) rule
    const rows: Array<{ version: number }> = await dataSource.query(
      `SELECT version FROM commission_rules WHERE id=$1`,
      [loserId],
    );
    await commissionRegistry.updateRule(loserId, { priority: 4, version: rows[0]!.version } as any, 'test');
    const recovery = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '30000',
      currency: 'NGN',
      idempotencyKey: `c02-21r-${randomUUID()}`,
    });
    expect(recovery.status).toBe('COMPLETED');
    const snaps = await snapshotsFor(`journal_id = $1`, [recovery.journalId]);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].commission_decision.allocations[0].amountMinor).toBe('50');
    expect(await walletBalance(agentWallet.ledgerAccountId)).toBe(500000n - 30000n); // debited exactly once
  });

  it('22. C2C product lifecycle: exactly ONE allocation across initiation + claim (the claim is NOT a commission event)', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_TO_CASH], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_CASH',
      percentageBps: 2000,
      agentClassId: bundle.cls.id,
    });
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '250' });
    const { result, phone } = await runC2cInitiation({ agentBundle: bundle });
    const claim = await runClaim(result, phone);

    const initSnaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    const claimSnaps = await snapshotsFor(`journal_id = $1`, [claim.journalId]);
    expect(initSnaps).toHaveLength(1);
    expect(claimSnaps).toHaveLength(1);
    // initiation carried the single economic commission event
    expect(initSnaps[0].commission_decision.status).toBe('ALLOCATED');
    expect(initSnaps[0].commission_decision.allocations).toHaveLength(1);
    expect(initSnaps[0].commission_decision.commissionEvent).toBe('CASH_TO_CASH_INITIATION');
    // the claim records NO commission and NO commissionEvent — the same rule would otherwise
    // match again (same product code), proving the claim path structurally never evaluates
    expect(claimSnaps[0].commission_decision).toEqual(NONE_SHAPE);
    const totalAllocations =
      initSnaps[0].commission_decision.allocations.length +
      claimSnaps[0].commission_decision.allocations.length;
    expect(totalAllocations).toBe(1); // one transfer = one commission event
    const claimLines = await journalLines(claim.journalId);
    expect(claimLines).toHaveLength(2);
    for (const l of claimLines) expect(l.amount_minor).toBe('30000');
  });

  it('23. customer history invariant: projection exposes principal/fee/currency only — commission evidence never leaks', async () => {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 2000,
      agentClassId: bundle.cls.id,
    });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '250' });
    const { customerId, result } = await runCashIn({ agentBundle: bundle });
    expect(result.status).toBe('COMPLETED');

    const page = await historyService.listUnified({ customerId, page: 1, limit: 20 });
    const item = page.items.find((i: any) => i.type === 'CASH_IN' && i.id === result.journalId)
      ?? page.items.find((i: any) => i.type === 'CASH_IN');
    expect(item).toBeDefined();
    expect(item.amountMinor).toBe('30000'); // principal only
    expect(item.currency).toBe('NGN');
    expect(item.feeMinor).toBe('0'); // real column: nothing POSTED (accounting boundary)
    // internal commercial machinery never surfaces to the customer
    for (const k of [
      'journalId',
      'ledgerAccountId',
      'snapshotId',
      'feeDecision',
      'commission',
      'commissionDecision',
      'commissions',
      'allocations',
      'commercialDecision',
      'beneficiaryId',
      'ruleRefs',
      'decisionPayload',
    ]) {
      expect(item).not.toHaveProperty(k);
    }
    // the decision record is intact machine-side (evidence separated from the customer view)
    const snaps = await snapshotsFor(`journal_id = $1`, [result.journalId]);
    expect(snaps[0].commission_decision.allocations[0].amountMinor).toBe('50');
  });

  it('24. financial isolation: no account families invented, every journal strictly principal-only, allocations appear on NO ledger line', async () => {
    const accountsBefore: Array<{ code: string }> = await dataSource.query(
      `SELECT code FROM ledger_accounts ORDER BY code`,
    );

    const bundleIn = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 2000,
      agentClassId: bundleIn.cls.id,
    });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '250' });
    const runIn = await runCashIn({ agentBundle: bundleIn } as any);

    const bundleOut = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234');
    await seedCommissionRule({
      productCode: 'WALLET_TO_CASH',
      percentageBps: 2000,
      agentClassId: bundleOut.cls.id,
    });
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '250' });
    const runOut = await runCashOut({ agentBundle: bundleOut });

    const bundleC2c = await createActiveAgentWithPin([AgentService.CASH_TO_CASH], '1234');
    await seedCommissionRule({
      productCode: 'CASH_TO_CASH',
      percentageBps: 2000,
      agentClassId: bundleC2c.cls.id,
    });
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '250' });
    const runC2c = await runC2cInitiation({ agentBundle: bundleC2c });

    const journalIds = [runIn.result.journalId, runOut.result.journalId, runC2c.result.journalId];
    // authoritative NON-wallet account family set is EXACTLY what we started with
    // (per-wallet WALLET-* fixture accounts are the flow's own user accounts, not new families;
    // no commission/fee-revenue family may have been created by running the flows)
    const accountsAfter: Array<{ code: string }> = await dataSource.query(
      `SELECT code FROM ledger_accounts ORDER BY code`,
    );
    const nonWallet = (rows: Array<{ code: string }>) =>
      rows.map((a) => a.code).filter((c) => !c.startsWith('WALLET-'));
    expect(nonWallet(accountsAfter)).toEqual(nonWallet(accountsBefore));
    expect(
      accountsAfter.filter((a) => /COMMISSION|FEE[-_]REVENUE/i.test(a.code)),
    ).toHaveLength(0);
    // every flow journal has exactly 2 legs, both at the PRINCIPAL amount
    for (const journalId of journalIds) {
      const lines = await journalLines(journalId);
      expect(lines).toHaveLength(2);
      for (const l of lines) expect(l.amount_minor).toBe('30000');
    }
    // the ALLOCATION amounts (50 kobo evidence) never appear on ANY ledger line in those journals
    const allocLines: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text AS cnt FROM ledger_lines WHERE journal_id = ANY($1::uuid[]) AND amount_minor <> 30000`,
      [journalIds],
    );
    expect(allocLines[0]!.cnt).toBe('0');
    // yet the evidence records exactly 50 per product = 150 total DECIDED
    const snaps = await snapshotsFor(`journal_id = ANY($1::uuid[])`, [journalIds]);
    expect(snaps).toHaveLength(3);
    let decidedTotal = 0n;
    for (const s of snaps) {
      expect(s.commission_decision.status).toBe('ALLOCATED');
      expect(s.commission_decision.payable).toBe(false);
      expect(s.commission_decision.allocations[0].amountMinor).toBe('50');
      decidedTotal += BigInt(s.commission_decision.allocations[0].amountMinor);
    }
    expect(decidedTotal.toString()).toBe('150'); // evidence-only; nothing owed, nothing posted
    // wallet effects are principal-only
    expect(await walletBalance(runIn.custWalletLedgerId)).toBe(30000n);
    expect(await walletBalance(runOut.custWalletLedgerId)).toBe(500000n - 30000n);
  });
});
