/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unsafe-argument */
// @ts-nocheck
/**
 * V1-COMMISSION-SETTLEMENT-VERIFICATION-01 — COMMISSION_PAYABLE lifecycle (real PG).
 *
 * Verification-only suite layered on top of the committed commercial battery (162/162). It proves
 * ONLY the gaps the existing suites do not already prove about the payable lifecycle:
 *
 *   S01 accrual ACCUMULATION — 3 real accruals grow the pooled COMMISSION_PAYABLE credit balance
 *       and COMMISSION_EXPENSE debit balance additively (exact minor units).
 *   S02 settlement ABSENCE + persistence — accrual evidence states
 *       ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED; the accounting service exposes no
 *       settlement entry point; a full C2C claim+expiry afterwards never reduces the payable.
 *   S03 pooled liability + beneficiary ATTRIBUTION — two different agents accrue into ONE pooled
 *       payable account; per-beneficiary attribution is preserved in the decision snapshots
 *       (allocations[].beneficiaryId = acting agent), not in sub-ledger accounts.
 *   S04 engine-level multi-allocation (AGENT + AGGREGATOR) on a real flow → accounting fails
 *       closed with COMMERCIAL_AGGREGATOR_ACCOUNTING_NOT_SUPPORTED; wallet unchanged; zero journals.
 *   S05 accounting-level multi-allocation total — two AGENT allocations post ONE lump
 *       DR expense / CR payable pair with allocationCount = 2 (service boundary).
 *   S06 AGENT_DEFUNDING independence — defunding an agent with a standing payable does NOT touch
 *       COMMISSION_PAYABLE (pool⇄wallet journals only; payable balance unchanged).
 *   S07 real-flow idempotent replay — same WTC idempotency key accrues exactly once.
 *   S08 service-level double recognition with the same base key resolves to the SAME journal
 *       (ledger idempotency inside the strategy boundary); the payable is credited once.
 *
 * PROVISIONAL TEST CONFIGURATION ONLY — fixtures exist solely inside this disposable per-process
 * database. Nothing here is a production rate, policy, or payout behaviour.
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
import { LedgerService } from '../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { CommissionRuleRegistryService } from '../src/commission/commission-rule-registry.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashOutService } from '../src/agent/agent-cash-out.service';
import { AgentCashToCashService } from '../src/agent/agent-cash-to-cash.service';
import { AgentCashToCashClaimService } from '../src/agent/agent-cash-to-cash-claim.service';
import { AgentCashToCashExpiryService } from '../src/agent/agent-cash-to-cash-expiry.service';
import { AgentFundingService } from '../src/agent/agent-funding.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { MfaExecutionService } from '../src/customer-authentication/mfa-execution.service';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { CommercialAccountingService } from '../src/commercial-accounting/commercial-accounting.service';
import { CommercialAccountingBlockedError } from '../src/commercial-accounting/commercial-accounting-registry.service';
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

const ACCOUNT_LEGEND = {
  FEE_REVENUE: 'FINANCE-FEE_REVENUE-NGN',
  VAT_PAYABLE: 'FINANCE-VAT_PAYABLE-NGN',
  COMMISSION_EXPENSE: 'FINANCE-COMMISSION_EXPENSE-NGN',
  COMMISSION_PAYABLE: 'FINANCE-COMMISSION_PAYABLE-NGN',
} as const;

describe('V1-COMMISSION-SETTLEMENT-VERIFICATION-01 (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let feeRuleRegistry: FeeRuleRegistryService;
  let commissionRegistry: CommissionRuleRegistryService;
  let cashOutService: AgentCashOutService;
  let cashToCashService: AgentCashToCashService;
  let claimService: AgentCashToCashClaimService;
  let expiryService: AgentCashToCashExpiryService;
  let fundingService: AgentFundingService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let mfaService: MfaExecutionService;
  let customerPinService: CustomerTransactionPinService;
  let accountingService: CommercialAccountingService;
  let systemLedgerAccountId: string;

  const expectLine = (lines: Array<any>, expected: Record<string, unknown>): void => {
    expect(lines).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
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
      if (!token || !token.startsWith('workforce-')) {
        throw new UnauthorizedException('invalid workforce token');
      }
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

  const ENV_KEYS = [
    'COMMERCIAL_ACCOUNTING_ENABLED',
    'COMMERCIAL_ACCOUNTING_VAT_TREATMENT',
    'COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT',
    'COMMERCIAL_COMMISSION_RECOGNITION_TIMING',
  ] as const;

  function configureAccounting(overrides: Record<string, string | undefined>): void {
    const base: Record<string, string | undefined> = {
      COMMERCIAL_ACCOUNTING_ENABLED: 'true',
      COMMERCIAL_ACCOUNTING_VAT_TREATMENT: 'EXCLUSIVE_ADD_ON',
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'EXPENSE_PAYABLE',
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'ACCRUE_NOW_SETTLE_LATER',
      ...overrides,
    };
    for (const key of ENV_KEYS) {
      const value = base[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-commission-settlement-01');
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
    walletService = app.get(WalletService);
    ledgerService = app.get(LedgerService);
    feeRuleRegistry = app.get(FeeRuleRegistryService);
    commissionRegistry = app.get(CommissionRuleRegistryService);
    cashOutService = app.get(AgentCashOutService);
    cashToCashService = app.get(AgentCashToCashService);
    claimService = app.get(AgentCashToCashClaimService);
    expiryService = app.get(AgentCashToCashExpiryService);
    fundingService = app.get(AgentFundingService);
    classService = app.get(AgentClassService);
    appService = app.get(AgentApplicationService);
    lifecycleService = app.get(AgentLifecycleService);
    pinService = app.get(AgentAuthenticationService);
    mfaService = app.get(MfaExecutionService);
    customerPinService = app.get(CustomerTransactionPinService);
    accountingService = app.get(CommercialAccountingService);
  }, 180000);

  afterAll(async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    configureAccounting({});
    await truncateAllTables(dataSource);
    await app.get(ProductCatalogSeedService).seedIfEmpty();
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
    await provisionAccountingFamilies();
  });

  async function provisionAccountingFamilies(): Promise<void> {
    const families = [
      { role: 'FEE_REVENUE', code: ACCOUNT_LEGEND.FEE_REVENUE, type: 'REVENUE', normal: 'CREDIT' },
      { role: 'VAT_PAYABLE', code: ACCOUNT_LEGEND.VAT_PAYABLE, type: 'LIABILITY', normal: 'CREDIT' },
      { role: 'COMMISSION_EXPENSE', code: ACCOUNT_LEGEND.COMMISSION_EXPENSE, type: 'EXPENSE', normal: 'DEBIT' },
      { role: 'COMMISSION_PAYABLE', code: ACCOUNT_LEGEND.COMMISSION_PAYABLE, type: 'LIABILITY', normal: 'CREDIT' },
    ];
    for (const f of families) {
      await dataSource.query(
        `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'NGN', 'CUSTOMER_FUNDS', FALSE, TRUE)
         ON CONFLICT (code) DO NOTHING`,
        [f.code, `${f.code} (test fixture)`, f.type, f.normal],
      );
      await dataSource.query(
        `INSERT INTO commercial_accounting_registry (
          family_code, account_code, account_type, normal_balance, currency, accounting_unit,
          purpose, decision_references, evidence_source, provisioned_by
        ) VALUES ($1, $2, $3, $4, 'NGN', 'CUSTOMER_FUNDS', 'test fixture mirroring migration 1785753600076', ARRAY['DP-31=A'], 'TEST', '1785753600076')
         ON CONFLICT (family_code) DO NOTHING`,
        [f.role, f.code, f.type, f.normal],
      );
    }
  }

  // ── harness helpers (mirror the committed proof suites) ──

  async function seedFeeRule(input: {
    productCode: string;
    flatFeeMinor?: string | null;
    percentageBps?: number | null;
    vatBps?: number | null;
  }): Promise<string> {
    const rule = await feeRuleRegistry.createRule(
      {
        productCode: input.productCode,
        currency: 'NGN',
        flatFeeMinor: input.flatFeeMinor ?? null,
        percentageBps: input.percentageBps ?? null,
        minimumFeeMinor: null,
        maximumFeeMinor: null,
        vatBps: input.vatBps === undefined ? null : input.vatBps,
        effectiveFrom: new Date(Date.now() - 86400000),
        priority: 0,
        isActive: true,
      },
      'test',
    );
    return rule.id;
  }

  async function seedCommissionRule(input: {
    productCode: string;
    percentageBps?: number | null;
    calculationBasis?: string;
    recipientType?: string;
  }): Promise<string> {
    const rule = await commissionRegistry.createRule(
      {
        productCode: input.productCode,
        currency: 'NGN',
        recipientType: input.recipientType ?? 'AGENT',
        calculationModel: 'PERCENTAGE',
        calculationBasis: input.calculationBasis ?? 'FEE',
        flatCommissionMinor: null,
        percentageBps: input.percentageBps ?? null,
        minimumCommissionMinor: null,
        maximumCommissionMinor: null,
        tiers: null,
        agentClassId: null,
        agentId: null,
        aggregatorId: null,
        effectiveFrom: new Date(Date.now() - 86400000),
        effectiveTo: null,
        priority: 0,
        isActive: true,
      } as any,
      'test',
    );
    return rule.id;
  }

  async function fundWallet(walletLedgerAccountId: string, amountMinor: string): Promise<void> {
    await dataSource.transaction(async (manager) => {
      await ledgerService.postJournalInTransaction(manager, {
        idempotencyKey: `csv01-fund-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: `CSVF-${walletLedgerAccountId.slice(0, 8)}`,
        lines: [
          { accountId: systemLedgerAccountId, direction: 'DEBIT', amountMinor },
          { accountId: walletLedgerAccountId, direction: 'CREDIT', amountMinor },
        ],
      });
    });
  }

  async function accountingJournals(): Promise<Array<any>> {
    return dataSource.query(
      `SELECT j.* FROM ledger_journals j WHERE j.idempotency_key LIKE '%:commercial-accounting' ORDER BY j.created_at`,
    );
  }

  async function linesForJournal(journalId: string): Promise<Array<any>> {
    return dataSource.query(
      `SELECT l.direction, l.amount_minor::text AS amount_minor, l.ledger_account_id, a.code AS account_code
       FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.ledger_account_id
       WHERE l.journal_id=$1 ORDER BY l.line_number`,
      [journalId],
    );
  }

  async function snapshotsFor(where: string, params: unknown[]): Promise<Array<any>> {
    return dataSource.query(`SELECT * FROM commercial_decision_snapshots WHERE ${where} ORDER BY created_at`, params);
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

  /** Signed balance of a pooled provisioning account (CR positive) by its legend code. */
  async function pooledBalance(accountCode: string): Promise<bigint> {
    const rows: Array<{ direction: string; amount_minor: string }> = await dataSource.query(
      `SELECT l.direction, l.amount_minor::text AS amount_minor
       FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.ledger_account_id
       WHERE a.code=$1`,
      [accountCode],
    );
    let balance = 0n;
    for (const r of rows) {
      balance += r.direction === 'CREDIT' ? BigInt(r.amount_minor) : -BigInt(r.amount_minor);
    }
    return balance;
  }

  function expectBlocked(error: any, code: string): void {
    const body = error instanceof CommercialAccountingBlockedError ? error.getResponse() : error?.response ?? error?.getResponse?.() ?? error;
    const blob = JSON.stringify(body);
    expect(blob).toContain(code);
    const isBlocked = error instanceof CommercialAccountingBlockedError || body?.error === code;
    expect(isBlocked).toBe(true);
  }

  function newPhone(): string {
    return `80${Math.floor(10000000 + Math.random() * 89999999)}`;
  }

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
      reference: `cls-csv01-${randomUUID().slice(0, 8)}`,
      code: `CSV01-${randomUUID().slice(0, 6)}`,
      name: 'CSV01 Class',
      isActive: true,
      applicableServices: services,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz CSV01 ${randomUUID().slice(0, 4)}`,
      contactEmail: `csv01-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-csv01',
    });
    await appService.submit(appEntity.id, 'applicant-csv01');
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
      idempotencyKey: `csv01-agent-wallet-${agent.id}-${randomUUID()}`,
    });
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    return { cls, agent, appEntity, wallet, walletLedgerAccountId: rows[0].ledger_account_id };
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

  async function createCustomerWithPhoneAndPin(phoneCanonical: string, pin: string) {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-csv01-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer CSV01',true)`,
      [customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$2,true,NOW())`,
      [customerId, phoneCanonical],
    );
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `csv01-cust-wallet-${customerId}-${randomUUID()}`,
    });
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    await customerPinService.setTransactionPin(customerId, {
      pinHash: hashPin(pin),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: customerId,
    });
    return { customerId, wallet, walletLedgerAccountId: rows[0].ledger_account_id };
  }

  async function createMfaChallenge(customerId: string, otp: string, ttlSeconds = 300) {
    const eRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO mfa_enrollments (id, customer_id, reference, status) VALUES ($1,$2,$3,'ENABLED') RETURNING id`,
      [randomUUID(), customerId, `mfa-enroll-${randomUUID().slice(0, 6)}`],
    );
    const enrollmentId = eRows[0]!.id;
    const mRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
      [randomUUID(), customerId, enrollmentId, `csv01-${randomUUID().slice(0, 6)}`],
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

  /** One WALLET_TO_CASH execution; returns the run context (fee 1000 / commission 100 under the test rules). */
  async function runCashOut(input: { amountMinor?: string; key?: string } = {}) {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, walletLedgerAccountId: custWalletLedgerId } =
      await createCustomerWithPhoneAndPin(phone, '1234');
    await fundWallet(custWalletLedgerId, '500000');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'WALLET_TO_CASH');
    const otp = 'csv01-otp';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const key = input.key ?? `csv01-out-${randomUUID()}`;
    const result = await cashOutService.execute({
      agentId: bundle.agent.id,
      agentPrincipal: agentPrincipal(bundle.agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp,
      amountMinor: input.amountMinor ?? '30000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    return { ...bundle, customerId, custWalletLedgerId, phone, result, key, challengeId, otp };
  }

  /** Minimal service-level commission-only invocation (fee ZERO → no fee legs). */
  async function postCommissionOnly(
    label: string,
    allocations: Array<Record<string, unknown>>,
    baseKey = `csv01-svc-${label}-${randomUUID()}`,
    snapKey?: string,
  ) {
    let outcome: any = null;
    await dataSource.transaction(async (manager) => {
      outcome = await accountingService.postForCompletion(manager, {
        productCode: 'CASH_TO_WALLET',
        currency: 'NGN',
        baseIdempotencyKey: baseKey,
        correlationId: null,
        reference: null,
        snapshotIdempotencyKey: snapKey ?? `csv01-snap-${label}-${randomUUID()}`,
        metadata: {},
        feePayerCustomerId: randomUUID(),
        feeDecision: { status: 'ZERO', feeMinor: '0' },
        commissionDecision: { status: 'ALLOCATED', allocations },
      });
    });
    return outcome;
  }

  // ═══════════════════ ACCRUE / ACCUMULATE ═══════════════════

  it('S01. three real accruals accumulate the pooled payable and expense balances additively', async () => {
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'WALLET_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });
    for (let i = 0; i < 3; i += 1) {
      const run = await runCashOut({ amountMinor: '30000' });
      expect(run.result.status).toBe('COMPLETED');
      expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toBe(BigInt(100 * (i + 1)));
      expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_EXPENSE)).toBe(BigInt(-100 * (i + 1)));
    }
    const journals = await accountingJournals();
    expect(journals).toHaveLength(3);
    for (const j of journals) {
      const lines = await linesForJournal(j.id);
      expectLine(lines, { direction: 'DEBIT', amount_minor: '100', account_code: ACCOUNT_LEGEND.COMMISSION_EXPENSE });
      expectLine(lines, { direction: 'CREDIT', amount_minor: '100', account_code: ACCOUNT_LEGEND.COMMISSION_PAYABLE });
      const dr = lines.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + BigInt(l.amount_minor), 0n);
      const cr = lines.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + BigInt(l.amount_minor), 0n);
      expect(dr).toBe(cr);
    }
  });

  it('S02. settlement is a V2 rail: evidence says so, no settle entry point exists, claim/expiry never reduce the payable', async () => {
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'CASH_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });

    // The accounting strategy boundary exposes exactly two public entry points — no settlement rail.
    const publicMethods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(accountingService),
    ).filter((n) => n !== 'constructor');
    expect(publicMethods).toContain('postForCompletion');
    expect(publicMethods).toContain('isEnabled');
    // No settlement/payout entry point exists anywhere on the strategy boundary.
    expect(publicMethods.filter((n) => /settle|payout|release/i.test(n))).toEqual([]);
    expect(typeof (accountingService as any).settleCommission).toBe('undefined');
    expect(typeof (accountingService as any).settlePayable).toBe('undefined');

    // Accrue via C2C initiation.
    const bundle = await createActiveAgentWithPin([AgentService.CASH_TO_CASH], '1234');
    await fundWallet(bundle.walletLedgerAccountId, '500000');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'AGENT', bundle.agent.id, 'CASH_TO_CASH');
    const beneficiaryPhone = newPhone();
    const init = await cashToCashService.execute({
      agentId: bundle.agent.id,
      agentPrincipal: agentPrincipal(bundle.agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone,
      amountMinor: '30000',
      currency: 'NGN',
      idempotencyKey: `csv01-s02-${randomUUID()}`,
    });
    expect(init.status).toBe('COMPLETED');
    expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toBe(100n);
    const snap = await snapshotsFor(`product='CASH_TO_CASH' AND direction='OUTGOING'`, []);
    expect(snap[0].commission_decision.payable).toBe(true);
    expect(snap[0].commission_decision.posting.settlementState).toBe(
      'ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED',
    );

    // Claim the transfer: no settlement happens, payable unchanged.
    const { customerId } = await createCustomerWithPhoneAndPin(beneficiaryPhone, '1234');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'CASH_TO_CASH');
    const { challengeId } = await createMfaChallenge(customerId, 'csv01-claim');
    const claim = await claimService.execute({
      transferId: init.transferId,
      beneficiaryPhone,
      transferCode: init.transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp: 'csv01-claim',
      idempotencyKey: `csv01-s02-claim-${randomUUID()}`,
    });
    expect(claim.status).toBe('COMPLETED');

    // Second transfer left to expire: likewise no settlement.
    const init2 = await cashToCashService.execute({
      agentId: bundle.agent.id,
      agentPrincipal: agentPrincipal(bundle.agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: newPhone(),
      amountMinor: '20000',
      currency: 'NGN',
      idempotencyKey: `csv01-s02b-${randomUUID()}`,
    });
    expect(init2.status).toBe('COMPLETED');
    expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toBe(200n);
    await dataSource.query(
      `UPDATE cash_to_cash_transfers SET expires_at = NOW() - INTERVAL '1 minute' WHERE id=$1`,
      [init2.transferId],
    );
    expect(await expiryService.expireOne(init2.transferId)).toBe(true);

    // After claim AND expiry the accrued payable still stands at the full total.
    expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toBe(200n);
    expect((await accountingJournals()).length).toBe(2);
  });

  it('S03. two agents accrue into ONE pooled payable; attribution lives in the snapshots', async () => {
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'WALLET_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });
    const run1 = await runCashOut({ amountMinor: '30000' });
    const run2 = await runCashOut({ amountMinor: '30000' });
    expect(run1.result.status).toBe('COMPLETED');
    expect(run2.result.status).toBe('COMPLETED');
    expect(run1.agent.id).not.toBe(run2.agent.id);

    // One pooled liability account holds the sum — no per-beneficiary sub-ledger exists.
    const payableAccountCount: Array<{ n: string }> = await dataSource.query(
      `SELECT COUNT(*)::text AS n FROM ledger_accounts WHERE code=$1`,
      [ACCOUNT_LEGEND.COMMISSION_PAYABLE],
    );
    expect(payableAccountCount[0].n).toBe('1');
    expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toBe(200n);

    // Attribution: each snapshot's allocation carries ITS acting agent; posting records the count.
    const snaps = await snapshotsFor(`product='WALLET_TO_CASH'`, []);
    expect(snaps).toHaveLength(2);
    const attributed = snaps.map((s) => s.commission_decision.allocations[0].beneficiaryId).sort();
    expect(attributed).toEqual([run1.agent.id, run2.agent.id].sort());
    for (const s of snaps) {
      expect(s.commission_decision.allocations[0].beneficiaryType).toBe('AGENT');
      expect(s.commission_decision.allocations[0].amountMinor).toBe('100');
      expect(s.commission_decision.posting.allocationCount).toBe(1);
      expect(s.commission_decision.posting.payableMinor).toBe('100');
    }
  });

  it('S04. engine multi-allocation (AGENT + AGGREGATOR) → accounting fails closed on a real flow', async () => {
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'WALLET_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE', recipientType: 'AGENT' });
    await seedCommissionRule({ productCode: 'WALLET_TO_CASH', percentageBps: 500, calculationBasis: 'FEE', recipientType: 'AGGREGATOR' });
    const bundle = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, walletLedgerAccountId } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundWallet(walletLedgerAccountId, '500000');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'WALLET_TO_CASH');
    const { challengeId } = await createMfaChallenge(customerId, 'csv01-s04');
    try {
      await cashOutService.execute({
        agentId: bundle.agent.id,
        agentPrincipal: agentPrincipal(bundle.agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: 'csv01-s04',
        amountMinor: '30000',
        currency: 'NGN',
        idempotencyKey: `csv01-s04-${randomUUID()}`,
      });
      throw new Error('expected aggregator blocker');
    } catch (e) {
      expectBlocked(e, 'COMMERCIAL_AGGREGATOR_ACCOUNTING_NOT_SUPPORTED');
    }
    expect((await accountingJournals()).length).toBe(0);
    expect((await snapshotsFor(`product='WALLET_TO_CASH'`, [])).length).toBe(0);
    expect(await walletBalance(walletLedgerAccountId)).toBe(500000n);
    expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toBe(0n);
  });

  it('S05. two AGENT allocations post ONE lump DR expense / CR payable (allocationCount 2)', async () => {
    const outcome = await postCommissionOnly('s05', [
      { beneficiaryType: 'AGENT', beneficiaryId: randomUUID(), amountMinor: '150', currency: 'NGN' },
      { beneficiaryType: 'AGENT', beneficiaryId: randomUUID(), amountMinor: '100', currency: 'NGN' },
    ]);
    expect(outcome.accountingJournalId).toBeTruthy();
    const lines = await linesForJournal(outcome.accountingJournalId);
    expect(lines).toHaveLength(2);
    expectLine(lines, { direction: 'DEBIT', amount_minor: '250', account_code: ACCOUNT_LEGEND.COMMISSION_EXPENSE });
    expectLine(lines, { direction: 'CREDIT', amount_minor: '250', account_code: ACCOUNT_LEGEND.COMMISSION_PAYABLE });
    expect(outcome.commissionPosting.allocationCount).toBe(2);
    expect(outcome.commissionPosting.expenseMinor).toBe('250');
    expect(outcome.commissionPosting.payableMinor).toBe('250');
    expect(outcome.commissionPosting.settlementState).toBe('ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED');
  });

  // ═══════════════════ DEFUNDING INDEPENDENCE ═══════════════════

  it('S06. AGENT_DEFUNDING with a standing payable: no coupling to COMMISSION_PAYABLE', async () => {
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'WALLET_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });
    const run = await runCashOut({ amountMinor: '30000' });
    expect(run.result.status).toBe('COMPLETED');
    expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toBe(100n);

    // Give the agent float headroom, then defund — a pure pool⇄wallet movement.
    await dataSource.query(
      `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
       VALUES (gen_random_uuid(),'AGENT_FUNDING_POOL-NGN','Agent Funding Pool NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE)
       ON CONFLICT (code) DO NOTHING`,
    );
    const pool: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='AGENT_FUNDING_POOL-NGN'`);
    await fundWallet(pool[0].id, '1000000');
    // Grant the fixture agent the funding capabilities on its class (test fixture only).
    await dataSource.query(
      `UPDATE agent_classes SET applicable_services=$2::jsonb WHERE id=$1`,
      [run.cls.id, JSON.stringify(['CASH_OUT', 'AGENT_FUNDING', 'AGENT_DEFUNDING'])],
    );
    const privilegedPrincipal: any = {
      type: 'PRIVILEGED', principalId: 'test-actor', roles: [], scopes: [],
      customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE',
    };
    const fund = await fundingService.fund({
      agentId: run.agent.id, amountMinor: '5000', currency: 'NGN',
      idempotencyKey: `csv01-s06-fund-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor',
    });
    expect(fund.status).toBe('COMPLETED');
    const before = await walletBalance(run.walletLedgerAccountId);
    const defund = await fundingService.defund({
      agentId: run.agent.id, amountMinor: '2000', currency: 'NGN',
      idempotencyKey: `csv01-s06-defund-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor',
    });
    expect(defund.status).toBe('COMPLETED');
    expect(await walletBalance(run.walletLedgerAccountId)).toBe(before - 2000n);

    // The accrued commission payable is untouched: still the full standing amount, still only
    // its original single credit line across the entire ledger.
    expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toBe(100n);
    const payableLines: Array<{ n: string }> = await dataSource.query(
      `SELECT COUNT(*)::text AS n FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE a.code=$1`,
      [ACCOUNT_LEGEND.COMMISSION_PAYABLE],
    );
    expect(payableLines[0].n).toBe('1');
  });

  // ═══════════════════ IDEMPOTENCY / DUPLICATION ═══════════════════

  it('S07. real-flow replay of the same WTC key accrues the payable exactly once', async () => {
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'WALLET_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });
    const key = `csv01-s07-${randomUUID()}`;
    const first = await runCashOut({ amountMinor: '30000', key });
    expect(first.result.status).toBe('COMPLETED');

    // True idempotent retry: same key, same (consumed) challenge — the flow detects the
    // completed idempotency record and the financial layer returns REPLAYED, no new journal.
    const replay = await cashOutService.execute({
      agentId: first.agent.id,
      agentPrincipal: agentPrincipal(first.agent.id) as any,
      agentPin: '1234',
      customerId: first.customerId,
      customerPin: '1234',
      mfaChallengeId: first.challengeId,
      otp: first.otp,
      amountMinor: '30000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    expect(['COMPLETED', 'REPLAYED']).toContain(replay.status);
    expect((await accountingJournals()).length).toBe(1);
    expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toBe(100n);
    expect((await snapshotsFor(`product='WALLET_TO_CASH'`, [])).length).toBe(1);
  });

  it('S08. service-level double recognition with the same base key resolves to the SAME journal; a differing request under that key is refused', async () => {
    const baseKey = `csv01-s08-${randomUUID()}`;
    const snapKey = `csv01-snap-s08-${randomUUID()}`;
    const alloc = [{ beneficiaryType: 'AGENT', beneficiaryId: randomUUID(), amountMinor: '175', currency: 'NGN' }];
    const first = await postCommissionOnly('s08a', alloc, baseKey, snapKey);
    // IDENTICAL duplicate request (the shape a flow idempotent retry produces): same journal.
    const second = await postCommissionOnly('s08b', alloc, baseKey, snapKey);
    expect(second.accountingJournalId).toBe(first.accountingJournalId);
    expect(second.accountingJournalIdempotencyKey).toBe(`${baseKey}:commercial-accounting`);
    expect((await accountingJournals()).length).toBe(1);
    expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toBe(175n);
    // A DIFFERENT request reusing the same key collides in the ledger and is refused closed.
    await expect(postCommissionOnly('s08c', alloc, baseKey)).rejects.toThrow(
      /idempotency key was already used/,
    );
    expect((await accountingJournals()).length).toBe(1);
    expect(await pooledBalance(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toBe(175n);
  });
});
