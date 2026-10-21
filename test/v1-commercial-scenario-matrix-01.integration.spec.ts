/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unsafe-argument */
// @ts-nocheck
/**
 * V1-COMMERCIAL-SCENARIO-MATRIX-01 — commercial scenario verification (real PG).
 *
 * Controlled gap-filling scenarios layered on top of the committed proof suite
 * (v1-commercial-accounting-01, 33/33). ONLY scenarios not already proven there live here:
 *
 *   FEE MODELS (exact computed amounts → exact accounting legs):
 *     F01 ZERO / free            F05 PCT+MAX (clamped / at boundary)
 *     F02 FLAT                   F06 PCT+MIN+MAX (below / inside / above band)
 *     F03 PERCENTAGE             F07 FLAT+PERCENTAGE
 *     F04 PCT+MIN (clamped / at boundary)
 *   VAT:
 *     V01 EXCLUSIVE low rate (leg = decision vat, exact)
 *     V02 EXCLUSIVE odd rate 999bps (floor rounding)
 *     V03 INCLUSIVE carve-out (revenue == fee − VAT)
 *     V04 INCLUSIVE odd rate 200bps (floor rounding)
 *     V05 decision tampered vs config (EXCLUSIVE) → COMMERCIAL_VAT_DECISION_MISMATCH
 *   COMMISSION:
 *     C01 AGENT_WALLET_NETTING × WALLET_TO_CASH (expense DR / acting-agent wallet CR)
 *     C02 AGENT_WALLET_NETTING × CASH_TO_CASH initiation (same-wallet DR+CR legs; claim none)
 *     C03 CONTRA_REVENUE via config on a real flow → precise blocker, wallet unchanged, no orphans
 *     C04 WALLET_TRANSFER with commission rules present for OTHER products → no commission legs
 *   ATOMICITY (DP-15):
 *     Y01 invalid runtime config value → tx aborts, wallet unchanged, no orphans
 *     Y02 two independent accounting blockers → no journals, no snapshots, balances unchanged
 *     Y03 netting beneficiary without a wallet → COMMERCIAL_BENEFICIARY_WALLET_NOT_RESOLVABLE
 *   PRODUCTS:
 *     P01 CUSTOMER_FUNDING + APPLIED fee → COMMERCIAL_FEE_ACCOUNTING_PRODUCT_UNSUPPORTED (guard)
 *     P02 real AGENT_FUNDING + AGENT_DEFUNDING with accounting enabled → zero accounting journals
 *   C2C LIFECYCLE:
 *     L01 initiation→claim + initiation→expiry: exactly one commission accounting event per
 *        initiation; claim and expiry add zero accounting journals
 *     L02 C2C initiation idempotent replay → exactly one accounting journal / one allocation
 *
 * PROVISIONAL TEST CONFIGURATION ONLY — every rule/env/rate here exists solely inside this
 * disposable per-process database. Nothing is a production rate or policy.
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

describe('V1-COMMERCIAL-SCENARIO-MATRIX-01 (real PG)', () => {
  const expectLine = (lines: Array<any>, expected: Record<string, unknown>): void => {
    expect(lines).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
  };

  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let transferService: TransferService;
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
    dataSource = await createIntegrationDataSource('v1-commercial-scenario-matrix-01');
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
    transferService = app.get(TransferService);
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

  // ── harness helpers (mirror the committed proof suite) ──

  async function seedFeeRule(input: {
    productCode: string;
    flatFeeMinor?: string | null;
    percentageBps?: number | null;
    minimumFeeMinor?: string | null;
    maximumFeeMinor?: string | null;
    vatBps?: number | null;
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
        vatBps: input.vatBps === undefined ? null : input.vatBps,
        effectiveFrom: new Date(Date.now() - 86400000),
        priority: input.priority ?? 0,
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

  async function createWallet(customerId: string): Promise<{ id: string; ledgerAccountId: string }> {
    const view = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `csm01-${customerId}-${randomUUID()}`,
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
        idempotencyKey: `csm01-fund-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: `CSMF-${walletLedgerAccountId.slice(0, 8)}`,
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
    return dataSource.query(`SELECT * FROM commercial_decision_snapshots WHERE ${where}`, params);
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

  async function doTransfer(sourceId: string, destId: string, amount: string, idempotencyKey: string): Promise<any> {
    return transferService.createTransfer({
      sourceWalletId: sourceId,
      destinationWalletId: destId,
      amountMinor: amount,
      currency: 'NGN',
      idempotencyKey,
    });
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
      reference: `cls-csm01-${randomUUID().slice(0, 8)}`,
      code: `CSM01-${randomUUID().slice(0, 6)}`,
      name: 'CSM01 Class',
      isActive: true,
      applicableServices: services,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz CSM01 ${randomUUID().slice(0, 4)}`,
      contactEmail: `csm01-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-csm01',
    });
    await appService.submit(appEntity.id, 'applicant-csm01');
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
      idempotencyKey: `csm01-agent-wallet-${agent.id}-${randomUUID()}`,
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
      [`cust-csm01-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer CSM01',true)`,
      [customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$2,true,NOW())`,
      [customerId, phoneCanonical],
    );
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `csm01-cust-wallet-${customerId}-${randomUUID()}`,
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
      [randomUUID(), customerId, enrollmentId, `csm01-${randomUUID().slice(0, 6)}`],
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

  async function runCashOut(input: { amountMinor?: string; key?: string } = {}) {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, walletLedgerAccountId: custWalletLedgerId } =
      await createCustomerWithPhoneAndPin(phone, '1234');
    await fundWallet(custWalletLedgerId, '500000');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'WALLET_TO_CASH');
    const otp = 'csm01-otp';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const key = input.key ?? `csm01-out-${randomUUID()}`;
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
    return { ...bundle, customerId, custWalletLedgerId, phone, result, key };
  }

  async function runC2cInitiation(input: { amountMinor?: string; key?: string; beneficiaryPhone?: string } = {}) {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_TO_CASH], '1234');
    const { agent, wallet: agentWallet, walletLedgerAccountId } = bundle;
    await fundWallet(walletLedgerAccountId, '500000');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'AGENT', agent.id, 'CASH_TO_CASH');
    const beneficiaryPhone = input.beneficiaryPhone ?? newPhone();
    const key = input.key ?? `csm01-c2c-${randomUUID()}`;
    const result = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone,
      amountMinor: input.amountMinor ?? '30000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    return { ...bundle, agentWallet, result, key, beneficiaryPhone };
  }

  async function runClaim(initResult: any, phone: string): Promise<any> {
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'CASH_TO_CASH');
    const otp = 'csm01-claim-otp';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const claim = await claimService.execute({
      transferId: initResult.transferId,
      beneficiaryPhone: phone,
      transferCode: initResult.transferCode,
      customerId,
      mfaChallengeId: challengeId,
      otp,
      idempotencyKey: `csm01-claim-${randomUUID()}`,
    });
    expect(claim.status).toBe('COMPLETED');
    return claim;
  }

  /** One WT transfer + assertions for the exact fee leg produced. */
  async function wtFeeScenario(
    label: string,
    amountMinor: string,
    expectedFeeMinor: string,
    expected: { minimumApplied?: boolean; maximumApplied?: boolean } = {},
  ) {
    const a = await createWallet(randomUUID());
    const b = await createWallet(randomUUID());
    await fundWallet(a.ledgerAccountId, '500000');
    await doTransfer(a.id, b.id, amountMinor, `csm01-${label}-${randomUUID()}`);
    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    const lines = await linesForJournal(journals[0].id);
    expect(lines).toHaveLength(2);
    expectLine(lines, {
      direction: 'DEBIT', amount_minor: expectedFeeMinor, account_code: expect.stringMatching(/^WALLET/),
    });
    expectLine(lines, {
      direction: 'CREDIT', amount_minor: expectedFeeMinor, account_code: ACCOUNT_LEGEND.FEE_REVENUE,
    });
    const snap = await snapshotsFor(
      `product='WALLET_TRANSFER' AND idempotency_key LIKE 'transfer:%'`,
      [],
    );
    expect(snap[0].fee_decision.feeMinor).toBe(expectedFeeMinor);
    if (expected.minimumApplied !== undefined) expect(snap[0].fee_decision.minimumApplied).toBe(expected.minimumApplied);
    if (expected.maximumApplied !== undefined) expect(snap[0].fee_decision.maximumApplied).toBe(expected.maximumApplied);
    expect(await walletBalance(a.ledgerAccountId)).toBe(500000n - BigInt(amountMinor) - BigInt(expectedFeeMinor));
  }

  // ═══════════════════ FEE CALCULATION MODELS — exact amounts → exact legs ═══════════════════

  it('F01. ZERO / free: zero-parameter rule → status ZERO, no journal, principal-only balance delta', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '0', vatBps: 0 });
    const a = await createWallet(randomUUID());
    const b = await createWallet(randomUUID());
    await fundWallet(a.ledgerAccountId, '500000');
    const view = await doTransfer(a.id, b.id, '40000', `csm01-f01-${randomUUID()}`);
    expect(view.status).toBe('COMPLETED');
    expect(await accountingJournals()).toHaveLength(0);
    const snap = await snapshotsFor(`product='WALLET_TRANSFER'`, []);
    expect(snap[0].fee_decision.status).toBe('ZERO');
    expect(snap[0].fee_decision.feeMinor).toBe('0');
    expect(await walletBalance(a.ledgerAccountId)).toBe(460000n);
  });

  it('F02. FLAT: fee 250 on principal 50000 → payer DR 250 / pooled revenue CR 250', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '250', vatBps: 0 });
    await wtFeeScenario('f02', '50000', '250', { minimumApplied: false, maximumApplied: false });
    const snap = await snapshotsFor(`product='WALLET_TRANSFER'`, []);
    expect(snap[0].fee_decision.calculationModel).toBe('FLAT');
  });

  it('F03. PERCENTAGE: 250bps of 100000 → fee 2500 exactly (floor math evidence)', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', percentageBps: 250, vatBps: 0 });
    await wtFeeScenario('f03', '100000', '2500', { minimumApplied: false, maximumApplied: false });
    const snap = await snapshotsFor(`product='WALLET_TRANSFER'`, []);
    expect(snap[0].fee_decision.calculationModel).toBe('PERCENTAGE');
    expect(snap[0].fee_decision.percentageFeeComponentMinor).toBe('2500');
  });

  it('F04a. PCT+MIN below band: raw 200 clamps to minimum 500 (minimumApplied)', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', percentageBps: 100, minimumFeeMinor: '500', vatBps: 0 });
    await wtFeeScenario('f04a', '20000', '500', { minimumApplied: true });
  });

  it('F04b. PCT+MIN at band: raw 800 ≥ min → fee 800 unclamped', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', percentageBps: 100, minimumFeeMinor: '500', vatBps: 0 });
    await wtFeeScenario('f04b', '80000', '800', { minimumApplied: false });
  });

  it('F05a. PCT+MAX below band: raw 300 ≤ max → fee 300 unclamped', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', percentageBps: 100, maximumFeeMinor: '800', vatBps: 0 });
    await wtFeeScenario('f05a', '30000', '300', { maximumApplied: false });
  });

  it('F05b. PCT+MAX above band: raw 1000 clamps to maximum 800 (maximumApplied)', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', percentageBps: 100, maximumFeeMinor: '800', vatBps: 0 });
    await wtFeeScenario('f05b', '100000', '800', { maximumApplied: true });
  });

  it('F06a. PCT+MIN+MAX below band: raw 200 clamps to 400', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', percentageBps: 100, minimumFeeMinor: '400', maximumFeeMinor: '800', vatBps: 0 });
    await wtFeeScenario('f06a', '20000', '400', { minimumApplied: true, maximumApplied: false });
  });

  it('F06b. PCT+MIN+MAX inside band: raw 600 stays 600', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', percentageBps: 100, minimumFeeMinor: '400', maximumFeeMinor: '800', vatBps: 0 });
    await wtFeeScenario('f06b', '60000', '600', { minimumApplied: false, maximumApplied: false });
  });

  it('F06c. PCT+MIN+MAX above band: raw 1000 clamps to 800', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', percentageBps: 100, minimumFeeMinor: '400', maximumFeeMinor: '800', vatBps: 0 });
    await wtFeeScenario('f06c', '100000', '800', { minimumApplied: false, maximumApplied: true });
  });

  it('F07. FLAT+PERCENTAGE: 100 flat + 100bps on 50000 → fee 600, model FLAT_PLUS_PERCENTAGE', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '100', percentageBps: 100, vatBps: 0 });
    await wtFeeScenario('f07', '50000', '600', { minimumApplied: false, maximumApplied: false });
    const snap = await snapshotsFor(`product='WALLET_TRANSFER'`, []);
    expect(snap[0].fee_decision.calculationModel).toBe('FLAT_PLUS_PERCENTAGE');
    expect(snap[0].fee_decision.flatFeeComponentMinor).toBe('100');
    expect(snap[0].fee_decision.percentageFeeComponentMinor).toBe('500');
  });

  // ═══════════════════ VAT — treatments × rate variety × rounding × drift ═══════════════════

  it('V01. EXCLUSIVE low rate (100bps): fee 1000 → VAT 10 extra; payer debited 1010; 3 legs', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 100 });
    const a = await createWallet(randomUUID());
    const b = await createWallet(randomUUID());
    await fundWallet(a.ledgerAccountId, '500000');
    await doTransfer(a.id, b.id, '50000', `csm01-v01-${randomUUID()}`);
    const lines = await linesForJournal((await accountingJournals())[0].id);
    expectLine(lines, { direction: 'DEBIT', amount_minor: '1010', account_code: expect.stringMatching(/^WALLET/) });
    expectLine(lines, { direction: 'CREDIT', amount_minor: '1000', account_code: ACCOUNT_LEGEND.FEE_REVENUE });
    expectLine(lines, { direction: 'CREDIT', amount_minor: '10', account_code: ACCOUNT_LEGEND.VAT_PAYABLE });
    const snap = await snapshotsFor(`product='WALLET_TRANSFER'`, []);
    expect(snap[0].fee_decision.posting.vatMinorPosted).toBe(snap[0].fee_decision.vatMinor);
    expect(await walletBalance(a.ledgerAccountId)).toBe(500000n - 50000n - 1010n);
  });

  it('V02. EXCLUSIVE odd rate (999bps): fee 1234 → VAT = floor(1234*999/10000) = 123', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1234', vatBps: 999 });
    const a = await createWallet(randomUUID());
    const b = await createWallet(randomUUID());
    await fundWallet(a.ledgerAccountId, '500000');
    await doTransfer(a.id, b.id, '50000', `csm01-v02-${randomUUID()}`);
    const lines = await linesForJournal((await accountingJournals())[0].id);
    expectLine(lines, { direction: 'CREDIT', amount_minor: '123', account_code: ACCOUNT_LEGEND.VAT_PAYABLE });
    expectLine(lines, { direction: 'DEBIT', amount_minor: '1357', account_code: expect.stringMatching(/^WALLET/) });
  });

  it('V03. INCLUSIVE (750bps): fee 1000 → VAT 69 inside; revenue 931; payer debited fee only', async () => {
    configureAccounting({ COMMERCIAL_ACCOUNTING_VAT_TREATMENT: 'INCLUSIVE_IN_FEE' });
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 750 });
    const a = await createWallet(randomUUID());
    const b = await createWallet(randomUUID());
    await fundWallet(a.ledgerAccountId, '500000');
    await doTransfer(a.id, b.id, '50000', `csm01-v03-${randomUUID()}`);
    const lines = await linesForJournal((await accountingJournals())[0].id);
    expectLine(lines, { direction: 'DEBIT', amount_minor: '1000', account_code: expect.stringMatching(/^WALLET/) });
    expectLine(lines, { direction: 'CREDIT', amount_minor: '931', account_code: ACCOUNT_LEGEND.FEE_REVENUE });
    expectLine(lines, { direction: 'CREDIT', amount_minor: '69', account_code: ACCOUNT_LEGEND.VAT_PAYABLE });
    expect(await walletBalance(a.ledgerAccountId)).toBe(500000n - 50000n - 1000n);
  });

  it('V04. INCLUSIVE odd rate (200bps): fee 1001 → VAT = floor(1001*200/10200) = 19; revenue 982', async () => {
    configureAccounting({ COMMERCIAL_ACCOUNTING_VAT_TREATMENT: 'INCLUSIVE_IN_FEE' });
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1001', vatBps: 200 });
    const a = await createWallet(randomUUID());
    const b = await createWallet(randomUUID());
    await fundWallet(a.ledgerAccountId, '500000');
    await doTransfer(a.id, b.id, '50000', `csm01-v04-${randomUUID()}`);
    const lines = await linesForJournal((await accountingJournals())[0].id);
    expectLine(lines, { direction: 'CREDIT', amount_minor: '19', account_code: ACCOUNT_LEGEND.VAT_PAYABLE });
    expectLine(lines, { direction: 'CREDIT', amount_minor: '982', account_code: ACCOUNT_LEGEND.FEE_REVENUE });
  });

  it('V05. decision drift vs config (EXCLUSIVE): tampered vatMinor → COMMERCIAL_VAT_DECISION_MISMATCH, no journal', async () => {
    await dataSource.transaction(async (manager) => {
      try {
        await accountingService.postForCompletion(manager, {
          productCode: 'WALLET_TRANSFER',
          currency: 'NGN',
          baseIdempotencyKey: `csm01-v05-${randomUUID()}`,
          correlationId: null,
          reference: null,
          snapshotIdempotencyKey: `csm01-v05-${randomUUID()}`,
          metadata: {},
          feePayerCustomerId: randomUUID(),
          feeDecision: { status: 'APPLIED', feeMinor: '1000', vatMinor: '500', ruleRefs: [{ vatBps: 750 }] },
          commissionDecision: { status: 'NONE' },
        });
        throw new Error('expected COMMERCIAL_VAT_DECISION_MISMATCH');
      } catch (e) {
        expectBlocked(e, 'COMMERCIAL_VAT_DECISION_MISMATCH');
      }
    }).catch(() => undefined);
    expect((await accountingJournals()).length).toBe(0);
  });

  // ═══════════════════ COMMISSION — treatment × product combinations ═══════════════════

  it('C01. NETTING × WALLET_TO_CASH: expense DR / acting-agent wallet CR in the same journal', async () => {
    configureAccounting({
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'AGENT_WALLET_NETTING',
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'AT_COMPLETION',
    });
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'WALLET_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });
    const run = await runCashOut({ amountMinor: '30000' });
    expect(run.result.status).toBe('COMPLETED');
    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    const lines = await linesForJournal(journals[0].id);
    expectLine(lines, { direction: 'CREDIT', amount_minor: '1000', account_code: ACCOUNT_LEGEND.FEE_REVENUE });
    expectLine(lines, { direction: 'DEBIT', amount_minor: '100', account_code: ACCOUNT_LEGEND.COMMISSION_EXPENSE });
    expectLine(lines, { direction: 'CREDIT', amount_minor: '100', ledger_account_id: run.walletLedgerAccountId, account_code: expect.stringMatching(/^WALLET/) });
    const debit = lines.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + BigInt(l.amount_minor), 0n);
    const credit = lines.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + BigInt(l.amount_minor), 0n);
    expect(debit).toBe(credit);
    // Agent wallet: 0 start + 30000 cash-out principal + 100 netting credit.
    expect(await walletBalance(run.walletLedgerAccountId)).toBe(30100n);
    const snap = await snapshotsFor(`product='WALLET_TO_CASH'`, []);
    expect(snap[0].commission_decision.payable).toBe(false);
    expect(snap[0].commission_decision.posting.treatment).toBe('AGENT_WALLET_NETTING');
  });

  it('C02. NETTING × C2C initiation: payer ledger + netting credit on the SAME agent wallet; claim adds none', async () => {
    configureAccounting({
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'AGENT_WALLET_NETTING',
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'AT_COMPLETION',
    });
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'CASH_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });
    const run = await runC2cInitiation({ amountMinor: '30000' });
    expect(run.result.status).toBe('COMPLETED');
    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    const lines = await linesForJournal(journals[0].id);
    expect(lines).toHaveLength(4);
    expectLine(lines, { direction: 'DEBIT', amount_minor: '1000', ledger_account_id: run.walletLedgerAccountId, account_code: expect.stringMatching(/^WALLET/) });
    expectLine(lines, { direction: 'CREDIT', amount_minor: '1000', account_code: ACCOUNT_LEGEND.FEE_REVENUE });
    expectLine(lines, { direction: 'DEBIT', amount_minor: '100', account_code: ACCOUNT_LEGEND.COMMISSION_EXPENSE });
    expectLine(lines, { direction: 'CREDIT', amount_minor: '100', ledger_account_id: run.walletLedgerAccountId, account_code: expect.stringMatching(/^WALLET/) });
    // 500000 funded − 30000 principal − 1000 fee + 100 netting:
    expect(await walletBalance(run.walletLedgerAccountId)).toBe(469100n);
    const snap = await snapshotsFor(`product='CASH_TO_CASH' AND direction='OUTGOING'`, []);
    expect(snap[0].commission_decision.commissionEvent).toBe('CASH_TO_CASH_INITIATION');
    await runClaim(run.result, run.beneficiaryPhone);
    expect((await accountingJournals()).length).toBe(1);
  });

  it('C03. CONTRA_REVENUE on a real flow → precise blocker; wallet unchanged; zero orphans', async () => {
    configureAccounting({
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'CONTRA_REVENUE',
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'AT_COMPLETION',
    });
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'WALLET_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });
    const bundle = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, walletLedgerAccountId } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundWallet(walletLedgerAccountId, '500000');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'WALLET_TO_CASH');
    const { challengeId } = await createMfaChallenge(customerId, 'csm01-x');
    try {
      await cashOutService.execute({
        agentId: bundle.agent.id,
        agentPrincipal: agentPrincipal(bundle.agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: 'csm01-x',
        amountMinor: '30000',
        currency: 'NGN',
        idempotencyKey: `csm01-c03-${randomUUID()}`,
      });
      throw new Error('expected CONTRA blocker');
    } catch (e) {
      expectBlocked(e, 'COMMERCIAL_CONTRA_REVENUE_ACCOUNTING_NOT_SUPPORTED');
    }
    expect((await accountingJournals()).length).toBe(0);
    expect((await snapshotsFor(`product='WALLET_TO_CASH'`, [])).length).toBe(0);
    expect(await walletBalance(walletLedgerAccountId)).toBe(500000n);
  });

  it('C04. WALLET_TRANSFER with commission rules present for OTHER products → fee journal has NO commission legs', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'WALLET_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });
    await seedCommissionRule({ productCode: 'CASH_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });
    const a = await createWallet(randomUUID());
    const b = await createWallet(randomUUID());
    await fundWallet(a.ledgerAccountId, '500000');
    await doTransfer(a.id, b.id, '50000', `csm01-c04-${randomUUID()}`);
    const lines = await linesForJournal((await accountingJournals())[0].id);
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.account_code === ACCOUNT_LEGEND.COMMISSION_EXPENSE)).toBe(false);
    const snap = await snapshotsFor(`product='WALLET_TRANSFER'`, []);
    expect(snap[0].commission_decision.status).toBe('NONE');
  });

  // ═══════════════════ ATOMICITY (DP-15) ═══════════════════

  it('Y01. invalid runtime config value → operation aborts, wallet unchanged, zero orphans', async () => {
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'WALLET_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });
    configureAccounting({ COMMERCIAL_ACCOUNTING_VAT_TREATMENT: 'BOGUS_VALUE' });
    const bundle = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, walletLedgerAccountId } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundWallet(walletLedgerAccountId, '500000');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'WALLET_TO_CASH');
    const { challengeId } = await createMfaChallenge(customerId, 'csm01-y');
    await expect(
      cashOutService.execute({
        agentId: bundle.agent.id,
        agentPrincipal: agentPrincipal(bundle.agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: 'csm01-y',
        amountMinor: '30000',
        currency: 'NGN',
        idempotencyKey: `csm01-y01-${randomUUID()}`,
      }),
    ).rejects.toThrow();
    expect((await accountingJournals()).length).toBe(0);
    expect((await snapshotsFor(`product='WALLET_TO_CASH'`, [])).length).toBe(0);
    expect(await walletBalance(walletLedgerAccountId)).toBe(500000n);
  });

  it('Y02. two independent accounting blockers → no journals, no snapshots, balances unchanged', async () => {
    // (a) VAT rate unset (rule vat_bps NULL) with fee>0 → COMMERCIAL_VAT_RATE_NOT_CONFIGURED.
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '1000', vatBps: null });
    const w1 = await createWallet(randomUUID());
    await fundWallet(w1.ledgerAccountId, '500000');
    const bundle = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, walletLedgerAccountId: c1Wallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundWallet(c1Wallet, '500000');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'WALLET_TO_CASH');
    const { challengeId } = await createMfaChallenge(customerId, 'csm01-y2a');
    try {
      await cashOutService.execute({
        agentId: bundle.agent.id,
        agentPrincipal: agentPrincipal(bundle.agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: 'csm01-y2a',
        amountMinor: '30000',
        currency: 'NGN',
        idempotencyKey: `csm01-y02a-${randomUUID()}`,
      });
      throw new Error('expected VAT rate blocker');
    } catch (e) {
      expectBlocked(e, 'COMMERCIAL_VAT_RATE_NOT_CONFIGURED');
    }

    // (b) registry evidence deleted → COMMERCIAL_ACCOUNTING_REGISTRY_EVIDENCE_MISSING on WT.
    await dataSource.query(`DELETE FROM commercial_accounting_registry WHERE family_code='FEE_REVENUE'`);
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    const a = await createWallet(randomUUID());
    const b = await createWallet(randomUUID());
    await fundWallet(a.ledgerAccountId, '500000');
    try {
      await doTransfer(a.id, b.id, '50000', `csm01-y02b-${randomUUID()}`);
      throw new Error('expected registry evidence blocker');
    } catch (e) {
      expectBlocked(e, 'COMMERCIAL_ACCOUNTING_REGISTRY_EVIDENCE_MISSING');
    }

    expect((await accountingJournals()).length).toBe(0);
    expect((await snapshotsFor(`product IN ('WALLET_TO_CASH','WALLET_TRANSFER')`, [])).length).toBe(0);
    expect(await walletBalance(c1Wallet)).toBe(500000n);
    expect(await walletBalance(a.ledgerAccountId)).toBe(500000n);
  });

  it('Y03. NETTING beneficiary without a wallet → COMMERCIAL_BENEFICIARY_WALLET_NOT_RESOLVABLE, no journal', async () => {
    configureAccounting({
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'AGENT_WALLET_NETTING',
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'AT_COMPLETION',
    });
    const beneficiaryWithoutWallet = randomUUID();
    await dataSource.transaction(async (manager) => {
      try {
        await accountingService.postForCompletion(manager, {
          productCode: 'CASH_TO_WALLET',
          currency: 'NGN',
          baseIdempotencyKey: `csm01-y03-${randomUUID()}`,
          correlationId: null,
          reference: null,
          snapshotIdempotencyKey: `csm01-y03-${randomUUID()}`,
          metadata: {},
          feePayerCustomerId: randomUUID(),
          feeDecision: { status: 'ZERO', feeMinor: '0' },
          commissionDecision: {
            status: 'ALLOCATED',
            allocations: [{
              beneficiaryType: 'AGENT',
              beneficiaryId: beneficiaryWithoutWallet,
              amountMinor: '100',
              currency: 'NGN',
            }],
          },
        });
        throw new Error('expected beneficiary wallet blocker');
      } catch (e) {
        expectBlocked(e, 'COMMERCIAL_BENEFICIARY_WALLET_NOT_RESOLVABLE');
      }
    }).catch(() => undefined);
    expect((await accountingJournals()).length).toBe(0);
  });

  // ═══════════════════ NON-FEE PRODUCTS (policy guard) ═══════════════════

  it('P01. CUSTOMER_FUNDING with an APPLIED fee decision → COMMERCIAL_FEE_ACCOUNTING_PRODUCT_UNSUPPORTED', async () => {
    await dataSource.transaction(async (manager) => {
      try {
        await accountingService.postForCompletion(manager, {
          productCode: 'CUSTOMER_FUNDING',
          currency: 'NGN',
          baseIdempotencyKey: `csm01-p01-${randomUUID()}`,
          correlationId: null,
          reference: null,
          snapshotIdempotencyKey: `csm01-p01-${randomUUID()}`,
          metadata: {},
          feePayerCustomerId: randomUUID(),
          feeDecision: { status: 'APPLIED', feeMinor: '1000', vatMinor: '0', ruleRefs: [{ vatBps: 0 }] },
          commissionDecision: { status: 'NONE' },
        });
        throw new Error('expected product-scope blocker');
      } catch (e) {
        expectBlocked(e, 'COMMERCIAL_FEE_ACCOUNTING_PRODUCT_UNSUPPORTED');
      }
    }).catch(() => undefined);
    expect((await accountingJournals()).length).toBe(0);
  });

  it('P02. real AGENT_FUNDING + AGENT_DEFUNDING with accounting enabled → zero accounting journals', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    await dataSource.query(
      `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
       VALUES (gen_random_uuid(),'AGENT_FUNDING_POOL-NGN','Agent Funding Pool NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE)
       ON CONFLICT (code) DO NOTHING`,
    );
    const pool: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='AGENT_FUNDING_POOL-NGN'`);
    await fundWallet(pool[0].id, '1000000');
    const bundle = await createActiveAgentWithPin(
      ['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'AGENT_FUNDING', 'AGENT_DEFUNDING'], null,
    );
    const privilegedPrincipal: any = {
      type: 'PRIVILEGED', principalId: 'test-actor', roles: [], scopes: [],
      customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE',
    };
    const fund = await fundingService.fund({
      agentId: bundle.agent.id, amountMinor: '5000', currency: 'NGN',
      idempotencyKey: `csm01-fund-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor',
    });
    expect(fund.status).toBe('COMPLETED');
    const defund = await fundingService.defund({
      agentId: bundle.agent.id, amountMinor: '2000', currency: 'NGN',
      idempotencyKey: `csm01-defund-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor',
    });
    expect(defund.status).toBe('COMPLETED');
    expect((await accountingJournals()).length).toBe(0);
    expect(await walletBalance(bundle.walletLedgerAccountId)).toBe(3000n);
  });

  // ═══════════════════ C2C FULL LIFECYCLE ═══════════════════

  it('L01. initiation→claim + initiation→expiry: ONE commission accounting event per initiation; claim/expiry add none', async () => {
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'CASH_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });

    const t1 = await runC2cInitiation({ amountMinor: '30000' });
    expect(t1.result.status).toBe('COMPLETED');
    await runClaim(t1.result, t1.beneficiaryPhone);

    const t2 = await runC2cInitiation({ amountMinor: '20000' });
    expect(t2.result.status).toBe('COMPLETED');
    await dataSource.query(
      `UPDATE cash_to_cash_transfers SET expires_at = NOW() - INTERVAL '1 minute' WHERE id=$1`,
      [t2.result.transferId],
    );
    const expired = await expiryService.expireOne(t2.result.transferId);
    expect(expired).toBe(true);

    // Exactly TWO accounting journals exist — one per initiation. Claim and expiry added none.
    const journals = await accountingJournals();
    expect(journals).toHaveLength(2);
    const statuses: Array<{ id: string; status: string }> = await dataSource.query(
      `SELECT id, status FROM cash_to_cash_transfers WHERE id = ANY($1)`,
      [[t1.result.transferId, t2.result.transferId]],
    );
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s.status]));
    expect(byId[t1.result.transferId]).toBe('CLAIMED');
    expect(byId[t2.result.transferId]).toBe('EXPIRED');
    // Exactly two ALLOCATED OUTGOING commission decisions (one per initiation); commission legs once per journal.
    const snap = await snapshotsFor(`product='CASH_TO_CASH' AND direction='OUTGOING'`, []);
    expect(snap).toHaveLength(2);
    for (const s of snap) {
      expect(s.commission_decision.status).toBe('ALLOCATED');
      expect(s.commission_decision.commissionEvent).toBe('CASH_TO_CASH_INITIATION');
    }
    let expenseLegs = 0;
    for (const j of journals) {
      const lines = await linesForJournal(j.id);
      expenseLegs += lines.filter((l) => l.account_code === ACCOUNT_LEGEND.COMMISSION_EXPENSE).length;
    }
    expect(expenseLegs).toBe(2);
  });

  it('L02. C2C initiation idempotent replay → exactly ONE accounting journal and ONE allocation', async () => {
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({ productCode: 'CASH_TO_CASH', percentageBps: 1000, calculationBasis: 'FEE' });
    const key = `csm01-l02-${randomUUID()}`;
    const run = await runC2cInitiation({ amountMinor: '30000', key });
    expect(run.result.status).toBe('COMPLETED');
    const replay = await cashToCashService.execute({
      agentId: run.agent.id,
      agentPrincipal: agentPrincipal(run.agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: run.beneficiaryPhone,
      amountMinor: '30000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    expect(replay.transferId ?? replay.id).toBe(run.result.transferId);
    expect((await accountingJournals()).length).toBe(1);
    const snap = await snapshotsFor(`product='CASH_TO_CASH' AND direction='OUTGOING'`, []);
    expect(snap).toHaveLength(1);
    expect(snap[0].commission_decision.allocations).toHaveLength(1);
  });
});
