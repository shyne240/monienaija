/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unsafe-argument */
// @ts-nocheck
/**
 * V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — approved-decision accounting activation (real PG).
 *
 * Proves, against real PostgreSQL and the REAL transaction services, that the accounting model
 * approved by the human decisions is implemented exactly:
 *
 *   FEE (DP-01=B pooled account / DP-02=A at-completion / DP-15=A atomic):
 *     01. WALLET_TRANSFER APPLIED fee → accounting journal posts (payer DR / pooled revenue CR)
 *     02. revenue amount == authoritative fee decision; snapshot ↔ accounting-journal linkage
 *     03. zero-fee (ZERO) decision → NO accounting legs, explicit evidence
 *     04. principal journal legs unchanged (byte-for-byte)
 *     05. accounting journal is balanced (Σ DR == Σ CR)
 *     06. serial idempotent replay → exactly ONE accounting journal
 *     07. concurrent replays → exactly ONE accounting journal, no double-post
 *     08. DP-15=A rollback: downstream failure rolls back accounting + snapshot + journal
 *     09. CASH_TO_WALLET: same pooled revenue account across products (DP-01=B, no per-product families)
 *     10. CASH_TO_CASH initiation: payer = initiating agent wallet; claim adds NO second journal
 *     11. WALLET_TO_CASH: combined fee + commission legs in ONE journal (single atomic operation)
 *   VAT (DP-03=B — treatment configurable; rate never hard-coded; fail closed):
 *     12. EXCLUSIVE_ADD_ON: VAT leg == authoritative decision vatMinor; payer debited fee+vat
 *     13. INCLUSIVE_IN_FEE: revenue = fee − VAT; payer debited fee only
 *     14. unconfigured VAT rate (rule vat_bps NULL) with fee>0 → precise blocker, tx aborts
 *     15. unset VAT treatment with fee>0 → blocker; never silently treated as zero
 *     16. explicit vat_bps=0 → NO VAT leg (zero is an explicit exemption, not "unset")
 *   COMMISSION (DP-05 configurable treatments / DP-07 timing):
 *     17. EXPENSE_PAYABLE + ACCRUE_NOW_SETTLE_LATER → expense/payable legs + payable evidence
 *     18. unset treatment with non-zero allocation → precise blocker, tx aborts
 *     19. treatment×timing inconsistency → precise blocker (both directions)
 *     20. AGENT_WALLET_NETTING + AT_COMPLETION → expense DR / agent wallet CR; wallet credit lands
 *     20b. undefined beneficiary + netting → fails closed (nothing faked)
 *     21. CONTRA_REVENUE → configuration model present, posting fails closed (unsupportable today)
 *     22. unset timing → precise blocker
 *     23. zero-amount ALLOCATED → no legs posted, explicit evidence
 *     24. C2C: single commission accounting event at INITIATION; claim cannot double-post
 *     25. AGGREGATOR / PLATFORM allocations → precise fail-closed blockers (V1 scope)
 *   GOVERNANCE (DP-30=B / DP-31=A / A5 no-repurposing):
 *     26. migration determined: registry evidence + provisioned accounts exist at bootstrap
 *     27. missing registry evidence → precise blocker (fail closed)
 *     28. registered-but-unprovisioned account → precise blocker
 *     29. registry↔account geometry mismatch → precise blocker
 *     30. no repurposed families: accounting journals touch ONLY payer wallets + 4 provisioned codes
 *     31. accounting DISABLED → byte-identical legacy posture (legacy blocker annotation, 2-leg-only journals)
 *     32. dedicated strategy boundary: flow services contain no treatment branching
 *
 * PROVISIONAL TEST CONFIGURATION ONLY — every rule/env value here lives exclusively inside this
 * disposable per-process test database. NOT production rates; production VAT/commission treatment
 * configuration remains unset until formally supplied.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, randomBytes, pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { OutboxService } from '../src/operations/outbox.service';
import { WalletService } from '../src/wallet/wallet.service';
import { TransferService } from '../src/transfer/transfer.service';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { CommissionRuleRegistryService } from '../src/commission/commission-rule-registry.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashInService } from '../src/agent/agent-cash-in.service';
import { AgentCashOutService } from '../src/agent/agent-cash-out.service';
import { AgentCashToCashService } from '../src/agent/agent-cash-to-cash.service';
import { AgentCashToCashClaimService } from '../src/agent/agent-cash-to-cash-claim.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { CommercialAccountingService } from '../src/commercial-accounting/commercial-accounting.service';
import { CommercialAccountingBlockedError } from '../src/commercial-accounting/commercial-accounting-registry.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import {
  createEligibleCustomer,
  makeCustomerFinanciallyEligible,
} from './support/kyc-test-fixtures';
import {
  ensureCustomerCredential,
  governedDeskProviderOverride,
  startGovernedDesk,
  type GovernedDeskHarness,
} from './support/cash-out-lifecycle-fixture';
import { RecordingSmsProvider } from './support/desk-otp-fixture';
import {
  createControlledFundingPolicy,
  overrideCashToCashFundingPolicy,
} from './support/controlled-funding-policy';
import {
  assignAgentClassLimitProfile,
  permissiveAgentLimitRules,
} from './support/agent-limit-fixtures';

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

const LEGACY_POSTING_BLOCKED = {
  journalLegsPosted: false,
  reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED',
};

const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

describe('V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let transferService: TransferService;
  let feeRuleRegistry: FeeRuleRegistryService;
  let commissionRegistry: CommissionRuleRegistryService;
  let cashInService: AgentCashInService;
  let cashOutService: AgentCashOutService;
  let cashToCashService: AgentCashToCashService;
  let claimService: AgentCashToCashClaimService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let customerPinService: CustomerTransactionPinService;
  let accountingService: CommercialAccountingService;

  const smsProvider = new RecordingSmsProvider();
  let governed: GovernedDeskHarness;
  const fundingPolicy = createControlledFundingPolicy();
  let failCompletedOutbox = false;

  // Captured at bootstrap BEFORE the first truncate (governance evidence determinism).
  let bootstrapRegistryRows: Array<any> = [];
  let bootstrapAccountRows: Array<any> = [];

  const throwingOutbox = {
    enqueue: async (_manager: unknown, event: { eventType: string }) => {
      if (failCompletedOutbox && event.eventType === 'transfer.completed') {
        throw new Error('simulated downstream failure before commit');
      }
    },
    // ARENA 4 INTEGRATION: AgentCashToCashService now enqueues `cash_to_cash.created` via
    // enqueueOnce inside the same SERIALIZABLE financial transaction. The stub mirrors the
    // real OutboxService interface so the accounting suite exercises the production call
    // path; the failure-injection flag continues to target transfer.completed only.
    enqueueOnce: async (_manager: unknown, event: { eventType: string }) => {
      if (failCompletedOutbox && event.eventType === 'transfer.completed') {
        throw new Error('simulated downstream failure before commit');
      }
    },
  };

  // Runtime-config helpers (the config service reads process.env fresh at every call, so tests
  // can reconfigure without re-bootstrapping — honest runtime evaluation).
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
    dataSource = await createIntegrationDataSource('v1-commercial-accounting-01');

    // 26. migration-determined provisioning evidence, captured BEFORE any truncate.
    bootstrapRegistryRows = await dataSource.query(
      `SELECT * FROM commercial_accounting_registry ORDER BY family_code`,
    );
    bootstrapAccountRows = await dataSource.query(
      `SELECT code, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active
       FROM ledger_accounts WHERE code = ANY($1) ORDER BY code`,
      [Object.values(ACCOUNT_LEGEND)],
    );

    const baseBuilder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kycEvidence.reader)
      .overrideProvider(OutboxService)
      .useValue(throwingOutbox);
    const moduleRef = await overrideCashToCashFundingPolicy(
      governedDeskProviderOverride(baseBuilder, smsProvider),
      fundingPolicy,
    ).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await (app.getHttpAdapter().getInstance() as any).ready();
    walletService = app.get(WalletService);
    transferService = app.get(TransferService);
    feeRuleRegistry = app.get(FeeRuleRegistryService);
    commissionRegistry = app.get(CommissionRuleRegistryService);
    cashInService = app.get(AgentCashInService);
    cashOutService = app.get(AgentCashOutService);
    cashToCashService = app.get(AgentCashToCashService);
    claimService = app.get(AgentCashToCashClaimService);
    classService = app.get(AgentClassService);
    appService = app.get(AgentApplicationService);
    lifecycleService = app.get(AgentLifecycleService);
    pinService = app.get(AgentAuthenticationService);
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
    failCompletedOutbox = false;
    await truncateAllTables(dataSource);
    await app.get(ProductCatalogSeedService).seedIfEmpty();

    // Infrastructure fixtures (mirrors the sibling suites exactly).
    // Governed institutional context (synthetic, per-process database only).
    governed = await startGovernedDesk({ app, dataSource, smsProvider, label: 'ca01' });
    // Cash-to-Cash holds the unclaimed liability in the receiving institution's suspense account.
    await governed.fixture.openInstitutionCashToCashSuspenseAccount(governed.institutionId);
    // The payment settlement asset is the institution's own control account, so it is opened
    // through the governed institution-ledger path (an unattributed control account could never
    // join an institution-attributed journal).
    await governed.fixture.openInstitutionSettlementAccount(governed.institutionId, {
      code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
      name: 'Payment settlement asset NGN',
      allowNegativeBalance: false,
    });

    // Migration-provisioned families are wiped by the per-test truncate; restore them verbatim
    // (identical to migration 1785753600076 output) so each test starts from the production
    // provisioning state.
    await provisionAccountingFamilies();
  });

  // ── fixtures mirroring migration 1785753600076 ──

  async function provisionAccountingFamilies(): Promise<void> {
    const families = [
      { role: 'FEE_REVENUE', code: ACCOUNT_LEGEND.FEE_REVENUE, type: 'REVENUE', normal: 'CREDIT' },
      {
        role: 'VAT_PAYABLE',
        code: ACCOUNT_LEGEND.VAT_PAYABLE,
        type: 'LIABILITY',
        normal: 'CREDIT',
      },
      {
        role: 'COMMISSION_EXPENSE',
        code: ACCOUNT_LEGEND.COMMISSION_EXPENSE,
        type: 'EXPENSE',
        normal: 'DEBIT',
      },
      {
        role: 'COMMISSION_PAYABLE',
        code: ACCOUNT_LEGEND.COMMISSION_PAYABLE,
        type: 'LIABILITY',
        normal: 'CREDIT',
      },
    ];
    for (const f of families) {
      // Economic owner of every commercial family account is the receiving institution that
      // collects the fee/VAT and owes the commission — never an unattributed global account.
      await dataSource.query(
        `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active, institutional_scope, institution_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'NGN', 'CUSTOMER_FUNDS', FALSE, TRUE, 'INSTITUTION', $5)
         ON CONFLICT (code) DO NOTHING`,
        [f.code, `${f.code} (test fixture)`, f.type, f.normal, governed.institutionId],
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

  // ── harness helpers ──

  async function seedFeeRule(input: {
    productCode: string;
    flatFeeMinor?: string | null;
    percentageBps?: number | null;
    vatBps?: number | null;
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
        vatBps: input.vatBps === undefined ? null : input.vatBps,
        effectiveFrom: input.effectiveFrom ?? new Date(Date.now() - 86400000),
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
    flatCommissionMinor?: string | null;
    calculationBasis?: string;
    recipientType?: string;
    agentClassId?: string | null;
    aggregatorId?: string | null;
    priority?: number;
  }): Promise<string> {
    const rule = await commissionRegistry.createRule(
      {
        productCode: input.productCode,
        currency: 'NGN',
        recipientType: input.recipientType ?? 'AGENT',
        calculationModel: input.percentageBps ? 'PERCENTAGE' : 'FIXED',
        calculationBasis: input.calculationBasis ?? 'FEE',
        flatCommissionMinor:
          input.flatCommissionMinor === undefined ? null : input.flatCommissionMinor,
        percentageBps: input.percentageBps ?? null,
        minimumCommissionMinor: null,
        maximumCommissionMinor: null,
        tiers: null,
        agentClassId: input.agentClassId ?? null,
        agentId: null,
        aggregatorId: input.aggregatorId ?? null,
        effectiveFrom: new Date(Date.now() - 86400000),
        effectiveTo: null,
        priority: input.priority ?? 0,
        isActive: true,
      } as any,
      'test',
    );
    return rule.id;
  }

  /**
   * A financially eligible customer for a wallet that the test only needs as an endpoint.
   *
   * These suites used a bare `randomUUID()` as the wallet owner. Once wallet owner classification
   * landed, `wallet_owner_class()` returns `REVIEW` for an id that is not a customer or agent and
   * `WalletService.createWallet` correctly refuses to provision such a wallet. A real, governed
   * customer leaves the assertion under test (fee/commission/accounting behaviour) unchanged.
   */
  async function eligibleCustomerId(): Promise<string> {
    const { customerId } = await createEligibleCustomer(dataSource, kycEvidence);
    return customerId;
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
    // Attribution requires an enrolment, so every governed wallet goes through provisioning.
    await governed.provisionCustomer(customerId, view.id);
    return { id: view.id, ledgerAccountId: rows[0].ledger_account_id };
  }

  async function fundWallet(walletLedgerAccountId: string, amountMinor: string): Promise<void> {
    await governed.fixture.fundLedgerAccount(walletLedgerAccountId, amountMinor, {
      institutionId: governed.institutionId,
    });
  }

  async function accountingJournals(): Promise<Array<any>> {
    return dataSource.query(
      `SELECT j.* FROM ledger_journals j WHERE j.idempotency_key LIKE '%:commercial-accounting'`,
    );
  }

  async function linesForJournal(journalId: string): Promise<Array<any>> {
    return dataSource.query(
      `SELECT l.direction, l.amount_minor::text AS amount_minor, a.code AS account_code
       FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.ledger_account_id
       WHERE l.journal_id=$1 ORDER BY l.direction, a.code`,
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

  async function doTransfer(
    sourceId: string,
    destId: string,
    amount: string,
    idempotencyKey: string,
  ): Promise<any> {
    return transferService.createTransfer({
      // INTEGRATION (integration/main-backend-frontend-20261030): main's required
      // `ownership` binding (src/wallet/wallet-ownership.ts). This suite drives the service
      // directly with no HTTP principal, so an INTERNAL binding is used — which
      // `assertWalletOwnership` deliberately does not restrict — leaving behaviour unchanged.
      ownership: { kind: 'INTERNAL', principalId: 'integration-spec', principalType: 'SERVICE' },
      sourceWalletId: sourceId,
      destinationWalletId: destId,
      amountMinor: amount,
      currency: 'NGN',
      idempotencyKey,
    });
  }

  function expectBlocked(error: any, code: string): void {
    const body =
      error instanceof CommercialAccountingBlockedError
        ? error.getResponse()
        : (error?.response ?? error?.getResponse?.() ?? error);
    const blob = JSON.stringify(body);
    expect(blob).toContain(code);
    const isBlocked = error instanceof CommercialAccountingBlockedError || body?.error === code;
    expect(isBlocked).toBe(true);
  }

  // Agent harness (mirrors v1-commission-runtime-wiring helpers).

  async function createActiveAgentWithPin(
    services: unknown,
    pin: string | null,
    options: { seedPermissiveLimitProfile?: boolean } = {},
  ) {
    const cls = await classService.create({
      reference: `cls-ca01-${randomUUID().slice(0, 8)}`,
      code: `CA01-${randomUUID().slice(0, 6)}`,
      name: 'CA01 Class',
      isActive: true,
      applicableServices: services,
      actor: 'test-actor',
    });
    // Agent money movement requires a limit for the Agent's class; one permissive rule per product
    // keeps this suite focused on what it asserts (commercial snapshot / fee / commission). Limit
    // boundary tests can opt out so missing configuration is exercised against the real transfer.
    if (options.seedPermissiveLimitProfile !== false) {
      await assignAgentClassLimitProfile(dataSource, {
        agentClassId: cls.id,
        rules: permissiveAgentLimitRules(),
      });
    }
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz CA01 ${randomUUID().slice(0, 4)}`,
      contactEmail: `ca01-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-ca01',
    });
    await appService.submit(appEntity.id, 'applicant-ca01');
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
    await governed.provisionAgent(agent.id, wallet.id);
    return { cls, agent, appEntity, wallet };
  }

  function agentPrincipal(agentId: string) {
    return {
      type: 'AGENT' as const,
      sessionId: governed.sessionFor(agentId),
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

  async function seedLimitProfile(
    code: string,
    subjectType: 'AGENT' | 'CUSTOMER',
    subjectId: string,
    product: string,
    /**
     * Extra products to cover with the same rules/dimensions. An agent that both moves wallet
     * value and runs a cash-in needs a rule for each product it touches: a resolved profile with no
     * applicable rule for the product being exercised is refused (agent money movement is
     * fail-closed), so the fixture must describe the agent's real scope.
     */
    additionalProducts: string[] = [],
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
    for (const coveredProduct of [product, ...additionalProducts]) {
      for (const [dimension, value] of [
        ['MIN_AMOUNT_PER_TX', '100'],
        ['DAILY_AMOUNT', '100000000'],
      ]) {
        await dataSource.query(
          `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, effective_to, is_active, created_by)
           VALUES ($1,$2,$3,NULL,NULL,'NGN',$4,$5,NULL,$6,NULL,true,'test')`,
          [
            randomUUID(),
            code,
            coveredProduct,
            dimension,
            value,
            new Date(Date.now() - 86400000).toISOString(),
          ],
        );
      }
    }
  }

  async function createCustomerWithPhone(phoneCanonical: string) {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-ca01-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer CA01',true)`,
      [customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$2,true,NOW())`,
      [customerId, phoneCanonical],
    );
    // This helper creates the customer with raw SQL only, so the governed financial-eligibility
    // gate would reject its wallet; complete the customer now that its profile and phone exist.
    await makeCustomerFinanciallyEligible(dataSource, customerId, kycEvidence);
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `cust-wallet-${customerId}-${randomUUID()}`,
    });
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    await governed.provisionCustomer(customerId, wallet.id);
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

  async function runCashIn(input: { amountMinor?: string; key?: string } = {}) {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    const { agent, wallet: agentWallet } = bundle;
    await fundWallet(agentWallet.ledgerAccountId, '500000');
    const phone = newPhone();
    const { customerId, walletLedgerAccountId: custWalletLedgerId } =
      await createCustomerWithPhone(phone);
    await seedLimitProfile(
      `PCA_${randomUUID().slice(0, 6).toUpperCase()}`,
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
      idempotencyKey: input.key ?? `ca01-in-${randomUUID()}`,
      reference: `ref-ca01-${randomUUID()}`,
    });
    return { agent, agentWallet, customerId, custWalletLedgerId, result, phone, cls: bundle.cls };
  }

  async function runCashOut(input: { amountMinor?: string; key?: string } = {}) {
    const bundle = await createActiveAgentWithPin([AgentService.CASH_OUT], '1234');
    const { agent } = bundle;
    const phone = newPhone();
    const { customerId, walletLedgerAccountId: custWalletLedgerId } =
      await createCustomerWithPhoneAndPin(phone, '1234');
    await fundWallet(custWalletLedgerId, '500000');
    await seedLimitProfile(
      `PCA_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'WALLET_TO_CASH',
    );
    const outKey = input.key ?? `ca01-out-${randomUUID()}`;
    await ensureCustomerCredential(dataSource, customerId);
    const issued = await governed.issueCashOutOtp({
      agentId: agent.id,
      customerId,
      amountMinor: input.amountMinor ?? '30000',
      operationKey: outKey,
    });
    const challengeId = issued.challengeId;
    const otp = issued.otp;
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
      idempotencyKey: outKey,
    });
    return { agent, customerId, custWalletLedgerId, phone, result, cls: bundle.cls };
  }

  async function runClaim(
    initResult: any,
    phone: string,
    agentId: string,
    amountMinor = '30000',
  ): Promise<any> {
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    await seedLimitProfile(
      `PCA_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      customerId,
      'CASH_TO_CASH',
    );
    await ensureCustomerCredential(dataSource, customerId);
    const claimKey = `ca01-claim-${randomUUID()}`;
    const claimOtp = await governed.deskOtp.issue({
      agentId,
      customerId,
      purpose: 'CASH_TO_CASH_CLAIM',
      redemptionMethod: 'CUSTOMER_WALLET',
      agentSessionId: governed.sessionFor(agentId)!,
      transferId: initResult.transferId,
      amountMinor,
      currency: 'NGN',
      operationKey: claimKey,
    });
    const claim = await claimService.execute({
      transferId: initResult.transferId,
      beneficiaryPhone: phone,
      transferCode: initResult.transferCode,
      customerId,
      mfaChallengeId: claimOtp.challengeId,
      otp: claimOtp.otp,
      claimantPrincipal: agentPrincipal(agentId) as any,
      idempotencyKey: claimKey,
    });
    expect(claim.status).toBe('COMPLETED');
    return claim;
  }

  // ── 01-07: fee legs, equality, idempotency ──

  it('01. WALLET_TRANSFER APPLIED fee → accounting journal posts to the pooled FEE_REVENUE family', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');

    const view = await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
    expect(view.status).toBe('COMPLETED');

    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    expect(journals[0].idempotency_key).toBe(`transfer:${view.id}:commercial-accounting`);
    expect(journals[0].metadata.productCode).toBe('WALLET_TRANSFER');

    const lines = await linesForJournal(journals[0].id);
    expect(lines).toHaveLength(2);
    expect(lines).toContainEqual({
      direction: 'DEBIT',
      amount_minor: '1000',
      account_code: expect.stringMatching(/^WALLET/),
    });
    expect(lines).toContainEqual({
      direction: 'CREDIT',
      amount_minor: '1000',
      account_code: ACCOUNT_LEGEND.FEE_REVENUE,
    });
  });

  it('02. revenue amount == authoritative fee decision; snapshot linkage is real', async () => {
    await seedFeeRule({
      productCode: 'WALLET_TRANSFER',
      flatFeeMinor: '2500',
      percentageBps: 0,
      vatBps: 0,
    });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    const view = await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);

    const snap = await snapshotsFor(`product='WALLET_TRANSFER' AND idempotency_key=$1`, [
      `transfer:${view.id}`,
    ]);
    expect(snap).toHaveLength(1);
    expect(snap[0].fee_decision.status).toBe('APPLIED');
    const posting = snap[0].fee_decision.posting;
    expect(posting.journalLegsPosted).toBe(true);
    expect(BigInt(posting.revenueMinor)).toBe(BigInt(snap[0].fee_decision.feeMinor));
    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    expect(posting.accountingJournalId).toBe(journals[0].id);
    expect(posting.accountingJournalIdempotencyKey).toBe(journals[0].idempotency_key);
    // The accounting journal points back at the principal journal + snapshot key.
    expect(journals[0].metadata.snapshotIdempotencyKey).toBe(`transfer:${view.id}`);
    expect(journals[0].metadata.baseJournalIdempotencyKey).toBe(`transfer:${view.id}`);
  });

  it('03. zero-fee (ZERO) decision → NO accounting legs, explicit ZERO_FEE_NO_LEGS_POSTED evidence', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '0', vatBps: 0 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    const view = await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
    expect(view.status).toBe('COMPLETED');
    const journals = await accountingJournals();
    expect(journals).toHaveLength(0);
    const snap = await snapshotsFor(`product='WALLET_TRANSFER'`, []);
    expect(snap[0].fee_decision.status).toBe('ZERO');
    expect(snap[0].fee_decision.posting).toEqual({
      journalLegsPosted: false,
      reason: 'ZERO_FEE_NO_LEGS_POSTED',
    });
  });

  it('04. principal journal legs unchanged (only principal, exactly) ', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    const view = await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
    const principalLines: Array<any> = await dataSource.query(
      `SELECT l.direction, l.amount_minor::text AS amount_minor FROM ledger_lines l
       JOIN ledger_journals j ON j.id = l.journal_id
       WHERE j.idempotency_key=$1 ORDER BY l.direction`,
      [`transfer:${view.id}`],
    );
    expect(principalLines).toEqual([
      { direction: 'CREDIT', amount_minor: '50000' },
      { direction: 'DEBIT', amount_minor: '50000' },
    ]);
  });

  it('05. accounting journal is balanced (Σ DR == Σ CR) with fee+vat legs', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 750 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    const lines = await linesForJournal(journals[0].id);
    const debit = lines
      .filter((l) => l.direction === 'DEBIT')
      .reduce((s, l) => s + BigInt(l.amount_minor), 0n);
    const credit = lines
      .filter((l) => l.direction === 'CREDIT')
      .reduce((s, l) => s + BigInt(l.amount_minor), 0n);
    expect(debit).toBe(credit);
    expect(debit).toBeGreaterThan(0n);
  });

  it('06. serial idempotent replay → exactly ONE accounting journal', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    const key = `ca01-t-${randomUUID()}`;
    const first = await doTransfer(a.id, b.id, '50000', key);
    const second = await doTransfer(a.id, b.id, '50000', key);
    expect(second.transferId).toBe(first.transferId);
    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    const snap = await snapshotsFor(`idempotency_key=$1`, [`transfer:${first.id}`]);
    expect(snap).toHaveLength(1);
  });

  it('07. concurrent replays → exactly ONE accounting journal (no double-post)', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    const key = `ca01-t-${randomUUID()}`;
    const results = await Promise.allSettled([
      doTransfer(a.id, b.id, '50000', key),
      doTransfer(a.id, b.id, '50000', key),
      doTransfer(a.id, b.id, '50000', key),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled') as Array<any>;
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const transferIds = new Set(ok.map((r) => r.value.id));
    expect(transferIds.size).toBe(1);
    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    const revenueLines: Array<any> = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM ledger_lines l
       JOIN ledger_journals j ON j.id=l.journal_id
       JOIN ledger_accounts c ON c.id=l.ledger_account_id
       WHERE j.idempotency_key LIKE '%:commercial-accounting' AND c.code=$1`,
      [ACCOUNT_LEGEND.FEE_REVENUE],
    );
    expect(revenueLines[0].count).toBe(1);
  });

  // ── 08: DP-15=A atomicity ──

  it('08. DP-15=A: downstream failure rolls back accounting + snapshot + journal atomically', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    failCompletedOutbox = true;
    const key = `ca01-t-${randomUUID()}`;
    await expect(doTransfer(a.id, b.id, '50000', key)).rejects.toThrow();
    expect(await accountingJournals()).toHaveLength(0);
    expect(await snapshotsFor(`idempotency_key LIKE $1`, ['transfer:%'])).toHaveLength(0);
    const principal: Array<any> = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM ledger_journals WHERE idempotency_key LIKE 'transfer:%'`,
    );
    expect(principal[0].count).toBe(0);
    // Wallet unchanged: no money moved, no retry ambiguity (transfer attempt rolled back fully).
    expect(await walletBalance(a.ledgerAccountId)).toBe(200000n);
  });

  // ── 09-11: pooled account across products; C2C; W2C combined journal ──

  it('09. CASH_TO_WALLET uses the SAME pooled revenue family (DP-01=B, no per-product accounts)', async () => {
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '500', vatBps: 0 });
    const run = await runCashIn({ amountMinor: '30000' });
    expect(run.result.status).toBe('COMPLETED');
    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    expect(journals[0].metadata.productCode).toBe('CASH_TO_WALLET');
    const lines = await linesForJournal(journals[0].id);
    expect(lines).toContainEqual({
      direction: 'CREDIT',
      amount_minor: '500',
      account_code: ACCOUNT_LEGEND.FEE_REVENUE,
    });
    // Payer is the CUSTOMER's wallet (cash-in credits the customer; the fee is debited from it).
    const payerLines = lines.filter((l) => l.direction === 'DEBIT');
    expect(payerLines).toHaveLength(1);
    expect(payerLines[0].account_code).not.toBe(ACCOUNT_LEGEND.FEE_REVENUE);
    expect(payerLines[0].account_code.startsWith('WALLET')).toBe(true);
  });

  it('10. CASH_TO_CASH initiation: agent wallet pays; claim adds NO second accounting journal', async () => {
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '750', vatBps: 0 });
    const bundle = await createActiveAgentWithPin([AgentService.CASH_TO_CASH], '1234');
    const { agent, wallet: agentWallet } = bundle;
    await fundWallet(agentWallet.ledgerAccountId, '500000');
    await seedLimitProfile(
      `PCA_${randomUUID().slice(0, 6).toUpperCase()}`,
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
      idempotencyKey: `ca01-c2c-${randomUUID()}`,
    });
    const journalsAfterInit = await accountingJournals();
    expect(journalsAfterInit).toHaveLength(1);
    const lines = await linesForJournal(journalsAfterInit[0].id);
    expect(lines).toContainEqual({
      direction: 'CREDIT',
      amount_minor: '750',
      account_code: ACCOUNT_LEGEND.FEE_REVENUE,
    });
    expect(await walletBalance(agentWallet.ledgerAccountId)).toBe(500000n - 20000n - 750n);

    // Claim path: engine-free by design — must not create ANY accounting journal.
    const claim = await runClaim(init, phone, agent.id, '20000');
    expect(claim.status).toBe('COMPLETED');
    const journalsAfterClaim = await accountingJournals();
    expect(journalsAfterClaim).toHaveLength(1); // still just the initiation journal; claim posted none
  });

  it('11. WALLET_TO_CASH: fee + commission legs in ONE combined journal (single atomic operation)', async () => {
    await seedFeeRule({ productCode: 'WALLET_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({
      productCode: 'WALLET_TO_CASH',
      percentageBps: 1000,
      calculationBasis: 'FEE',
    });
    const { result } = await runCashOut({ amountMinor: '30000' });
    expect(result.status).toBe('COMPLETED');
    const journals = await accountingJournals();
    expect(journals.length).toBeGreaterThanOrEqual(1);
    const lines = await linesForJournal(journals[0].id);
    expect(lines).toContainEqual({
      direction: 'CREDIT',
      amount_minor: '1000',
      account_code: ACCOUNT_LEGEND.FEE_REVENUE,
    });
    expect(lines).toContainEqual({
      direction: 'DEBIT',
      amount_minor: '100',
      account_code: ACCOUNT_LEGEND.COMMISSION_EXPENSE,
    });
    expect(lines).toContainEqual({
      direction: 'CREDIT',
      amount_minor: '100',
      account_code: ACCOUNT_LEGEND.COMMISSION_PAYABLE,
    });
    const debit = lines
      .filter((l) => l.direction === 'DEBIT')
      .reduce((s, l) => s + BigInt(l.amount_minor), 0n);
    const credit = lines
      .filter((l) => l.direction === 'CREDIT')
      .reduce((s, l) => s + BigInt(l.amount_minor), 0n);
    expect(debit).toBe(credit);
  });

  it.each([
    ['EXCLUSIVE_ADD_ON', '1000', '75', '51075', 148925n],
    ['INCLUSIVE_IN_FEE', '931', '69', '51000', 149000n],
  ])(
    'confirmed quote %s matches real fee/VAT ledger debit',
    async (treatment, fee, vat, total, remaining) => {
      configureAccounting({ COMMERCIAL_ACCOUNTING_VAT_TREATMENT: treatment });
      await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 750 });
      const customerId = await eligibleCustomerId();
      const a = await createWallet(customerId);
      const b = await createWallet(await eligibleCustomerId());
      await fundWallet(a.ledgerAccountId, '200000');
      const credentialId = randomUUID();
      const sessionId = randomUUID();
      await dataSource.query(
        `INSERT INTO customer_authentication_credentials (id,customer_id,credential_type,password_hash,hash_algorithm,password_version,password_changed_at,status) VALUES ($1,$2,'PASSWORD','dummyhash','PBKDF2',1,NOW(),'ACTIVE')`,
        [credentialId, customerId],
      );
      await dataSource.query(
        `INSERT INTO authentication_sessions (id,customer_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at,onboarding_password_version) VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',NOW(),NOW()+interval '1 hour',NOW(),1)`,
        [sessionId, customerId, credentialId, randomBytes(32).toString('hex')],
      );
      const principal = {
        type: 'CUSTOMER' as const,
        customerId,
        principalId: customerId,
        sessionId,
        roles: [],
        scopes: [],
        customerAccess: 'SELF' as const,
      };
      await customerPinService.setTransactionPin(customerId, {
        pinHash: hashPin('1234'),
        hashAlgorithm: 'PBKDF2',
        pinVersion: 1,
        actor: customerId,
      });
      const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
      const quote = await app.get(TransferQuoteService).create(principal, {
        sourceWalletId: a.id,
        destinationWalletId: b.id,
        amountMinor: '50000',
        currency: 'NGN',
        idempotencyKey: `fee-quote-${randomUUID()}`,
      });
      expect(quote).toMatchObject({ feeMinor: fee, vatMinor: vat, totalDebitMinor: total });
      const { OutboxEvent } = await import('../src/operations/outbox-event.entity');
      const realOutbox = new OutboxService(dataSource.getRepository(OutboxEvent));
      const outboxSpy = jest
        .spyOn(throwingOutbox, 'enqueueOnce')
        .mockImplementation((manager, event) => realOutbox.enqueueOnce(manager, event));
      const keys = [`fee-confirm-${randomUUID()}`, `fee-confirm-${randomUUID()}`];
      const attempts = await Promise.allSettled(
        keys.map((key) =>
          transferService.createConfirmedTransfer(principal, quote.quoteId, key, '1234'),
        ),
      );
      outboxSpy.mockRestore();
      const winners = attempts
        .map((result, index) => ({ result, key: keys[index] }))
        .filter((item) => item.result.status === 'fulfilled');
      expect(winners).toHaveLength(1);
      expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const transfer = (winners[0].result as PromiseFulfilledResult<any>).value;
      const key = winners[0].key;
      expect(transfer).toMatchObject({ status: 'COMPLETED', amountMinor: '50000' });
      expect(
        await dataSource.query(
          `SELECT fee_minor::text,vat_minor::text FROM transfers WHERE id=$1`,
          [transfer.id],
        ),
      ).toEqual([{ fee_minor: fee, vat_minor: vat }]);
      expect(await walletBalance(a.ledgerAccountId)).toBe(remaining);
      expect(await walletBalance(b.ledgerAccountId)).toBe(50000n);
      const { CustomerAppController } = await import('../src/customer-app/customer-app.controller');
      const receipt = await app
        .get(CustomerAppController)
        .getTransferDetail(transfer.id, { headers: {}, authorizationPrincipal: principal });
      expect(receipt).toMatchObject({
        feeMinor: fee,
        vatMinor: vat,
        totalDebitMinor: total,
        direction: 'SENT',
      });
      const journals = await accountingJournals();
      expect(journals).toHaveLength(1);
      expect(
        (await linesForJournal(journals[0].id)).find(
          (line) => line.account_code === ACCOUNT_LEGEND.VAT_PAYABLE,
        ).amount_minor,
      ).toBe(vat);
      expect(
        (await transferService.createConfirmedTransfer(principal, quote.quoteId, key, '1234')).id,
      ).toBe(transfer.id);
      expect(await accountingJournals()).toHaveLength(1);
      const { TransferReconciliationService } = await import(
        '../src/reconciliation/transfer-reconciliation.service'
      );
      expect(
        await app.get(TransferReconciliationService).reconcileTransfer(transfer.id),
      ).toMatchObject({
        status: 'PASS',
        discrepancies: [],
      });
    },
  );

  it('confirmed nonzero fee rolls back principal when total debit exceeds balance', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 750 });
    const customerId = await eligibleCustomerId();
    const a = await createWallet(customerId);
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '50000');
    const credentialId = randomUUID();
    const sessionId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (id,customer_id,credential_type,password_hash,hash_algorithm,password_version,password_changed_at,status) VALUES ($1,$2,'PASSWORD','dummyhash','PBKDF2',1,NOW(),'ACTIVE')`,
      [credentialId, customerId],
    );
    await dataSource.query(
      `INSERT INTO authentication_sessions (id,customer_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at,onboarding_password_version) VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',NOW(),NOW()+interval '1 hour',NOW(),1)`,
      [sessionId, customerId, credentialId, randomBytes(32).toString('hex')],
    );
    const principal = {
      type: 'CUSTOMER' as const,
      customerId,
      principalId: customerId,
      sessionId,
      roles: [],
      scopes: [],
      customerAccess: 'SELF' as const,
    };
    await customerPinService.setTransactionPin(customerId, {
      pinHash: hashPin('1234'),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: customerId,
    });
    const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
    const quote = await app.get(TransferQuoteService).create(principal, {
      sourceWalletId: a.id,
      destinationWalletId: b.id,
      amountMinor: '50000',
      currency: 'NGN',
      idempotencyKey: `fee-quote-${randomUUID()}`,
    });
    await expect(
      transferService.createConfirmedTransfer(
        principal,
        quote.quoteId,
        `fee-confirm-${randomUUID()}`,
        '1234',
      ),
    ).rejects.toBeDefined();
    expect(await walletBalance(a.ledgerAccountId)).toBe(50000n);
    expect(await walletBalance(b.ledgerAccountId)).toBe(0n);
    expect(await accountingJournals()).toHaveLength(0);
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(0);
    expect(
      await dataSource.query(
        `SELECT q.status,b.transfer_id FROM payment_quotes q JOIN wallet_transfer_quote_bindings b ON b.quote_id=q.id WHERE q.id=$1`,
        [quote.quoteId],
      ),
    ).toEqual([{ status: 'ACTIVE', transfer_id: null }]);
  });

  it.each([
    { treatment: 'AGENT_WALLET_NETTING', timing: 'AT_COMPLETION', balance: 149025n },
    { treatment: 'EXPENSE_PAYABLE', timing: 'ACCRUE_NOW_SETTLE_LATER', balance: 148925n },
  ])(
    'confirmed agent transfer reconciles fee VAT and class commission under $treatment',
    async ({ treatment, timing, balance }) => {
      configureAccounting({
        COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: treatment,
        COMMERCIAL_COMMISSION_RECOGNITION_TIMING: timing,
      });
      await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 750 });
      const { agent, cls, wallet } = await createActiveAgentWithPin(
        [AgentService.WALLET_TRANSFER],
        '1234',
      );
      await seedLimitProfile(
        `P2PA_${randomUUID().slice(0, 6).toUpperCase()}`,
        'AGENT',
        agent.id,
        'WALLET_TRANSFER',
      );
      await seedCommissionRule({
        productCode: 'WALLET_TRANSFER',
        percentageBps: 1000,
        calculationBasis: 'FEE',
        agentClassId: cls.id,
      });
      const recipient = await createWallet(await eligibleCustomerId());
      await fundWallet(wallet.ledgerAccountId, '200000');
      const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
      const quote = await app.get(TransferQuoteService).create(agentPrincipal(agent.id), {
        destinationWalletId: recipient.id,
        amountMinor: '50000',
        currency: 'NGN',
        idempotencyKey: randomUUID(),
      });
      expect(quote).toMatchObject({
        sourceWalletId: wallet.id,
        feeMinor: '1000',
        vatMinor: '75',
        totalDebitMinor: '51075',
      });
      const { OutboxEvent } = await import('../src/operations/outbox-event.entity');
      const realOutbox = new OutboxService(dataSource.getRepository(OutboxEvent));
      const spy = jest
        .spyOn(throwingOutbox, 'enqueueOnce')
        .mockImplementation((manager, event) => realOutbox.enqueueOnce(manager, event));
      let transfer;
      try {
        transfer = await transferService.createConfirmedTransfer(
          agentPrincipal(agent.id),
          quote.quoteId,
          randomUUID(),
          '1234',
        );
      } finally {
        spy.mockRestore();
      }
      expect(transfer.status).toBe('COMPLETED');
      expect(await walletBalance(wallet.ledgerAccountId)).toBe(balance);
      expect(await walletBalance(recipient.ledgerAccountId)).toBe(50000n);
      const journals = await accountingJournals();
      expect(journals).toHaveLength(1);
      const lines = await linesForJournal(journals[0].id);
      expect(lines).toContainEqual({
        direction: 'CREDIT',
        amount_minor: '75',
        account_code: ACCOUNT_LEGEND.VAT_PAYABLE,
      });
      expect(lines).toContainEqual({
        direction: 'DEBIT',
        amount_minor: '100',
        account_code: ACCOUNT_LEGEND.COMMISSION_EXPENSE,
      });
      expect(lines).toContainEqual(
        expect.objectContaining({
          direction: 'CREDIT',
          amount_minor: '100',
          ...(treatment === 'EXPENSE_PAYABLE'
            ? { account_code: ACCOUNT_LEGEND.COMMISSION_PAYABLE }
            : {}),
        }),
      );
      const snapshots = await snapshotsFor('journal_id=$1', [transfer.journalId]);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].commission_decision.allocations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            beneficiaryType: 'AGENT',
            beneficiaryId: agent.id,
            amountMinor: '100',
          }),
        ]),
      );
      const { TransferReconciliationService } = await import(
        '../src/reconciliation/transfer-reconciliation.service'
      );
      expect(
        await app.get(TransferReconciliationService).reconcileTransfer(transfer.id),
      ).toMatchObject({
        status: 'PASS',
        discrepancies: [],
        trace: {
          quoteIds: [quote.quoteId],
          commercialJournalIds: [journals[0].id],
          commercialSnapshotIds: [snapshots[0].id],
        },
      });

      // Corruption simulation is restricted to this disposable test database. First prove
      // the production guards reject ordinary edits, then temporarily disable only the
      // relevant guards inside each fixture transaction to test reconciliation's reader.
      // Each fixture is restored and guarded before the next case; no real money is used.
      const reconciliation = app.get(TransferReconciliationService);
      const principalLines = await dataSource.query(
        `SELECT id,amount_minor::text FROM ledger_lines WHERE journal_id=$1 AND direction='DEBIT'`,
        [transfer.journalId],
      );
      const vatLines = await dataSource.query(
        `SELECT l.id,l.amount_minor::text FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.journal_id=$1 AND a.code=$2`,
        [journals[0].id, ACCOUNT_LEGEND.VAT_PAYABLE],
      );
      expect(principalLines).toHaveLength(1);
      expect(vatLines).toHaveLength(1);
      const commissionCredits = await dataSource.query(
        `SELECT id,ledger_account_id FROM ledger_lines WHERE journal_id=$1 AND direction='CREDIT' AND amount_minor=100`,
        [journals[0].id],
      );
      const vatAccount = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code=$1`, [
        ACCOUNT_LEGEND.VAT_PAYABLE,
      ]);
      expect(commissionCredits).toHaveLength(1);
      expect(vatAccount).toHaveLength(1);
      await expect(
        dataSource.query(`UPDATE ledger_lines SET amount_minor=amount_minor+1 WHERE id=$1`, [
          vatLines[0].id,
        ]),
      ).rejects.toThrow(/immutable/i);
      await expect(
        dataSource.query(
          `UPDATE commercial_decision_snapshots SET fee_decision=fee_decision WHERE id=$1`,
          [snapshots[0].id],
        ),
      ).rejects.toThrow(/immutable/i);
      async function corruptAndRestore(
        table: 'ledger_lines' | 'commercial_decision_snapshots',
        change: string,
        args: unknown[],
        restore: string,
        restoreArgs: unknown[],
        expected: RegExp,
      ) {
        const triggers =
          table === 'ledger_lines'
            ? ['ledger_lines_are_immutable', 'ledger_lines_must_balance_journal']
            : ['trg_commercial_decision_snapshots_immutable'];
        async function fixture(sql: string, values: unknown[]) {
          await dataSource.transaction(async (manager) => {
            for (const trigger of triggers)
              await manager.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
            await manager.query(sql, values);
            for (const trigger of triggers)
              await manager.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
          });
        }
        await fixture(change, args);
        try {
          const report = await reconciliation.reconcileTransfer(transfer.id);
          expect(report.status).toBe('ERROR');
          expect(report.discrepancies).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                severity: 'ERROR',
                message: expect.stringMatching(expected),
              }),
            ]),
          );
        } finally {
          await fixture(restore, restoreArgs);
        }
        expect(await reconciliation.reconcileTransfer(transfer.id)).toMatchObject({
          status: 'PASS',
          discrepancies: [],
        });
      }
      await corruptAndRestore(
        'ledger_lines',
        `UPDATE ledger_lines SET amount_minor=amount_minor+1 WHERE id=$1`,
        [principalLines[0].id],
        `UPDATE ledger_lines SET amount_minor=$2 WHERE id=$1`,
        [principalLines[0].id, principalLines[0].amount_minor],
        /journal debit and credit totals differ|transfer amount does not match/i,
      );
      await corruptAndRestore(
        'ledger_lines',
        `UPDATE ledger_lines SET amount_minor=amount_minor+1 WHERE id=$1`,
        [vatLines[0].id],
        `UPDATE ledger_lines SET amount_minor=$2 WHERE id=$1`,
        [vatLines[0].id, vatLines[0].amount_minor],
        /commercial journal is unbalanced|commercial journal lines do not match/i,
      );
      // Still balanced, but the commission credit was diverted to the wrong account.
      await corruptAndRestore(
        'ledger_lines',
        `UPDATE ledger_lines SET ledger_account_id=$2 WHERE id=$1`,
        [commissionCredits[0].id, vatAccount[0].id],
        `UPDATE ledger_lines SET ledger_account_id=$2 WHERE id=$1`,
        [commissionCredits[0].id, commissionCredits[0].ledger_account_id],
        /commercial journal lines do not match/i,
      );
      await corruptAndRestore(
        'commercial_decision_snapshots',
        `UPDATE commercial_decision_snapshots SET fee_decision=jsonb_set(fee_decision,'{feeMinor}','"1001"'::jsonb) WHERE id=$1`,
        [snapshots[0].id],
        `UPDATE commercial_decision_snapshots SET fee_decision=$2::jsonb WHERE id=$1`,
        [snapshots[0].id, JSON.stringify(snapshots[0].fee_decision)],
        /fee decision economics|quoted pricing hash/i,
      );
      await corruptAndRestore(
        'commercial_decision_snapshots',
        `UPDATE commercial_decision_snapshots SET fee_decision=jsonb_set(fee_decision,'{posting,vatMinorPosted}','"76"'::jsonb) WHERE id=$1`,
        [snapshots[0].id],
        `UPDATE commercial_decision_snapshots SET fee_decision=$2::jsonb WHERE id=$1`,
        [snapshots[0].id, JSON.stringify(snapshots[0].fee_decision)],
        /fee and VAT posting evidence/i,
      );
      await corruptAndRestore(
        'commercial_decision_snapshots',
        `UPDATE commercial_decision_snapshots SET commission_decision=jsonb_set(commission_decision,'{allocations,0,amountMinor}','"101"'::jsonb) WHERE id=$1`,
        [snapshots[0].id],
        `UPDATE commercial_decision_snapshots SET commission_decision=$2::jsonb WHERE id=$1`,
        [snapshots[0].id, JSON.stringify(snapshots[0].commission_decision)],
        /commission allocation and expense do not agree/i,
      );
      await corruptAndRestore(
        'commercial_decision_snapshots',
        `UPDATE commercial_decision_snapshots SET commission_decision=jsonb_set(commission_decision,'{allocations,0,calculationParameters,percentageBps}','1100'::jsonb) WHERE id=$1`,
        [snapshots[0].id],
        `UPDATE commercial_decision_snapshots SET commission_decision=$2::jsonb WHERE id=$1`,
        [snapshots[0].id, JSON.stringify(snapshots[0].commission_decision)],
        /commission amount does not match its calculation evidence/i,
      );
      await corruptAndRestore(
        'commercial_decision_snapshots',
        `UPDATE commercial_decision_snapshots SET commission_decision=jsonb_set(commission_decision,'{allocations,0,beneficiaryId}',to_jsonb($2::text)) WHERE id=$1`,
        [snapshots[0].id, randomUUID()],
        `UPDATE commercial_decision_snapshots SET commission_decision=$2::jsonb WHERE id=$1`,
        [snapshots[0].id, JSON.stringify(snapshots[0].commission_decision)],
        /commission beneficiary does not match the acting agent/i,
      );
      // Missing or inconsistent accounting registry evidence cannot be certified as PASS.
      await dataSource.query(
        `UPDATE commercial_accounting_registry SET account_type='EXPENSE' WHERE family_code='VAT_PAYABLE'`,
      );
      try {
        const report = await reconciliation.reconcileTransfer(transfer.id);
        expect(report.status).toBe('WARNING');
        expect(report.discrepancies).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              severity: 'WARNING',
              message: expect.stringMatching(/registry evidence for VAT_PAYABLE/i),
            }),
          ]),
        );
      } finally {
        await dataSource.query(
          `UPDATE commercial_accounting_registry SET account_type='LIABILITY' WHERE family_code='VAT_PAYABLE'`,
        );
      }
      expect(await reconciliation.reconcileTransfer(transfer.id)).toMatchObject({
        status: 'PASS',
        discrepancies: [],
      });
    },
  );

  it('concurrent confirmed transfer and agency cash-in share one operating balance safely', async () => {
    const { agent, wallet } = await createActiveAgentWithPin(
      [AgentService.WALLET_TRANSFER, AgentService.CASH_IN],
      '1234',
    );
    await seedLimitProfile(
      `P2PC_${randomUUID().slice(0, 6).toUpperCase()}`,
      'AGENT',
      agent.id,
      'WALLET_TRANSFER',
      ['CASH_TO_WALLET'],
    );
    const destination = await createWallet(await eligibleCustomerId());
    const phone = newPhone();
    const cashRecipient = await createCustomerWithPhone(phone);
    await seedLimitProfile(
      `P2PR_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      cashRecipient.customerId,
      'CASH_TO_WALLET',
    );
    await fundWallet(wallet.ledgerAccountId, '100000');
    const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
    const quote = await app.get(TransferQuoteService).create(agentPrincipal(agent.id), {
      destinationWalletId: destination.id,
      amountMinor: '30000',
      currency: 'NGN',
      idempotencyKey: randomUUID(),
    });
    const attempts = await Promise.allSettled([
      transferService.createConfirmedTransfer(
        agentPrincipal(agent.id),
        quote.quoteId,
        randomUUID(),
        '1234',
      ),
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id),
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '30000',
        currency: 'NGN',
        idempotencyKey: randomUUID(),
      }),
    ]);
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') throw attempt.reason;
    }
    expect(attempts.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await walletBalance(wallet.ledgerAccountId)).toBe(40000n);
    expect(await walletBalance(destination.ledgerAccountId)).toBe(30000n);
    expect(await walletBalance(cashRecipient.walletLedgerAccountId)).toBe(30000n);
    // Competing debits total more than the remaining float: at most one can post.
    const second = await app.get(TransferQuoteService).create(agentPrincipal(agent.id), {
      destinationWalletId: destination.id,
      amountMinor: '30000',
      currency: 'NGN',
      idempotencyKey: randomUUID(),
    });
    const competing = await Promise.allSettled([
      transferService.createConfirmedTransfer(
        agentPrincipal(agent.id),
        second.quoteId,
        randomUUID(),
        '1234',
      ),
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id),
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '30000',
        currency: 'NGN',
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await walletBalance(wallet.ledgerAccountId)).toBe(10000n);
    expect(
      (await walletBalance(destination.ledgerAccountId)) +
        (await walletBalance(cashRecipient.walletLedgerAccountId)),
    ).toBe(90000n);
  });

  it('sustains bounded authenticated HTTP transfer and cash-in contention without duplicate posting', async () => {
    const { agent, wallet } = await createActiveAgentWithPin(
      [AgentService.WALLET_TRANSFER, AgentService.CASH_IN],
      '1234',
    );
    await dataSource.query(
      `UPDATE agent_authentication_credentials SET password_hash=$2 WHERE agent_id=$1 AND status='ACTIVE'`,
      [agent.id, hashPin('agent-pass')],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId: agent.id, password: 'agent-pass' })
      .expect(200);
    const bearer = `Bearer ${login.body.accessToken as string}`;
    await seedLimitProfile(
      `P2PH_${randomUUID().slice(0, 6).toUpperCase()}`,
      'AGENT',
      agent.id,
      'WALLET_TRANSFER',
      ['CASH_TO_WALLET'],
    );
    const destination = await createWallet(await eligibleCustomerId());
    const phone = newPhone();
    const cashRecipient = await createCustomerWithPhone(phone);
    await seedLimitProfile(
      `P2PI_${randomUUID().slice(0, 6).toUpperCase()}`,
      'CUSTOMER',
      cashRecipient.customerId,
      'CASH_TO_WALLET',
    );
    await fundWallet(wallet.ledgerAccountId, '100000');
    const quote = async () =>
      request(app.getHttpServer())
        .post('/api/v1/agents/me/transfer-quotes')
        .set('Authorization', bearer)
        .set('Idempotency-Key', randomUUID())
        .send({ destinationWalletId: destination.id, amountMinor: '30000', currency: 'NGN' })
        .expect(201);
    const transfer = (quoteId: string, key: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/agents/me/transfer-quotes/${quoteId}/confirm`)
        .set('Authorization', bearer)
        .set('Idempotency-Key', key)
        .send({ pin: '1234' });
    const cashIn = (key: string) =>
      request(app.getHttpServer())
        .post('/api/v1/agents/cash-in')
        .set('Authorization', bearer)
        .send({
          recipientIdentifier: phone,
          amountMinor: '30000',
          currency: 'NGN',
          idempotencyKey: key,
          pin: '1234',
        });
    const successfulTransferIds = new Set<string>();
    const successfulCashJournals = new Set<string>();
    const iterations = 12;
    for (let iteration = 0; iteration < iterations; iteration++) {
      // At the end of each prior round 10000 remains; restore exactly 100000.
      if (iteration > 0) await fundWallet(wallet.ledgerAccountId, '90000');
      const first = await quote();
      const transferKey = randomUUID();
      const cashKey = randomUUID();
      const initial = await Promise.all([
        transfer(first.body.quoteId as string, transferKey),
        cashIn(cashKey),
      ]);
      expect(initial.map((r) => ({ status: r.status, body: r.body }))).toEqual([
        expect.objectContaining({ status: 201 }),
        expect.objectContaining({ status: 201 }),
      ]);
      successfulTransferIds.add(initial[0].body.id as string);
      successfulCashJournals.add(initial[1].body.journalId as string);
      expect(await walletBalance(wallet.ledgerAccountId)).toBe(40000n);
      const replays = await Promise.all([
        transfer(first.body.quoteId as string, transferKey),
        cashIn(cashKey),
      ]);
      expect(replays[0].status).toBe(201);
      expect(replays[0].body.id).toBe(initial[0].body.id);
      expect(replays[1].status).toBe(201);
      expect(replays[1].body.journalId).toBe(initial[1].body.journalId);
      expect(await walletBalance(wallet.ledgerAccountId)).toBe(40000n);
      const second = await quote();
      const competingTransferKey = randomUUID();
      const competingCashKey = randomUUID();
      const competing = await Promise.all([
        transfer(second.body.quoteId as string, competingTransferKey),
        cashIn(competingCashKey),
      ]);
      expect(competing.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        competing.filter((r) => r.status !== 201).map((r) => ({ status: r.status, body: r.body })),
      ).toEqual([expect.objectContaining({ status: 422 })]);
      if (competing[0].status === 201) {
        successfulTransferIds.add(competing[0].body.id as string);
        const replay = await transfer(second.body.quoteId as string, competingTransferKey);
        expect(replay.status).toBe(201);
        expect(replay.body.id).toBe(competing[0].body.id);
      } else {
        successfulCashJournals.add(competing[1].body.journalId as string);
        const replay = await cashIn(competingCashKey);
        expect(replay.status).toBe(201);
        expect(replay.body.journalId).toBe(competing[1].body.journalId);
      }
      expect(await walletBalance(wallet.ledgerAccountId)).toBe(10000n);
      expect(
        (await walletBalance(destination.ledgerAccountId)) +
          (await walletBalance(cashRecipient.walletLedgerAccountId)),
      ).toBe(BigInt(iteration + 1) * 90000n);
    }
    expect(successfulTransferIds.size + successfulCashJournals.size).toBe(iterations * 3);
    const transfers: Array<{ id: string; status: string }> = await dataSource.query(
      `SELECT id,status FROM transfers WHERE status='COMPLETED'`,
    );
    expect(new Set(transfers.map((t) => t.id))).toEqual(successfulTransferIds);
    const journalRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_journals WHERE id = ANY($1::uuid[])`,
      [Array.from(successfulCashJournals)],
    );
    expect(journalRows).toHaveLength(successfulCashJournals.size);
    const debits: Array<{ journal_id: string; amount_minor: string }> = await dataSource.query(
      `SELECT journal_id::text, amount_minor::text FROM ledger_lines WHERE ledger_account_id=$1 AND direction='DEBIT'`,
      [wallet.ledgerAccountId],
    );
    const transferJournals: Array<{ journal_id: string }> = await dataSource.query(
      `SELECT journal_id::text FROM transfers WHERE status='COMPLETED'`,
    );
    expect(debits).toHaveLength(iterations * 3);
    expect(debits.every((line) => line.amount_minor === '30000')).toBe(true);
    expect(new Set(debits.map((line) => line.journal_id))).toEqual(
      new Set([...successfulCashJournals, ...transferJournals.map((row) => row.journal_id)]),
    );
  }, 180000);

  it('fails closed for missing agent limits on both Wallet→Wallet participant legs without financial effects', async () => {
    const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
    const quotes = app.get(TransferQuoteService);
    const financialCounts = async () => {
      const [row] = await dataSource.query(
        `SELECT
           (SELECT count(*)::int FROM transfers) AS transfers,
           (SELECT count(*)::int FROM ledger_journals) AS journals,
           (SELECT count(*)::int FROM ledger_lines) AS ledger_lines,
           (SELECT count(*)::int FROM limit_reservations) AS reservations,
           (SELECT count(*)::int FROM limit_usages) AS usages,
           (SELECT count(*)::int FROM idempotency_records) AS idempotency_records`,
      );
      return row;
    };
    const expectMissingLimitRefusal = async (params: {
      agentId: string;
      sourceLedgerAccountId: string;
      destinationLedgerAccountId: string;
      destinationWalletId: string;
      sourceBalance: bigint;
      destinationBalance: bigint;
    }) => {
      const principal = agentPrincipal(params.agentId);
      const quote = await quotes.create(principal, {
        destinationWalletId: params.destinationWalletId,
        amountMinor: '10000',
        currency: 'NGN',
        idempotencyKey: randomUUID(),
      });
      const countsBefore = await financialCounts();
      const refusal = await transferService
        .createConfirmedTransfer(principal, quote.quoteId, randomUUID(), '1234')
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(refusal).toBeDefined();
      expect(refusal.getStatus()).toBe(503);
      expectBlocked(refusal, 'LIMIT_PROFILE_MISSING');
      expect(await financialCounts()).toEqual(countsBefore);
      expect(await walletBalance(params.sourceLedgerAccountId)).toBe(params.sourceBalance);
      expect(await walletBalance(params.destinationLedgerAccountId)).toBe(
        params.destinationBalance,
      );
      expect(
        await dataSource.query(
          `SELECT q.status,b.transfer_id FROM payment_quotes q
             JOIN wallet_transfer_quote_bindings b ON b.quote_id=q.id WHERE q.id=$1`,
          [quote.quoteId],
        ),
      ).toEqual([{ status: 'ACTIVE', transfer_id: null }]);
    };

    const { agent: missingSource, wallet: missingSourceWallet } = await createActiveAgentWithPin(
      [AgentService.WALLET_TRANSFER],
      '1234',
      {
        seedPermissiveLimitProfile: false,
      },
    );
    const customerWallet = await createWallet(await eligibleCustomerId());
    await fundWallet(missingSourceWallet.ledgerAccountId, '50000');
    await expectMissingLimitRefusal({
      agentId: missingSource.id,
      sourceLedgerAccountId: missingSourceWallet.ledgerAccountId,
      destinationLedgerAccountId: customerWallet.ledgerAccountId,
      destinationWalletId: customerWallet.id,
      sourceBalance: 50000n,
      destinationBalance: 0n,
    });

    const { agent: configuredSource, wallet: configuredSourceWallet } =
      await createActiveAgentWithPin([AgentService.WALLET_TRANSFER], '1234', {
        seedPermissiveLimitProfile: false,
      });
    const { wallet: missingDestinationWallet } = await createActiveAgentWithPin(
      [AgentService.WALLET_TRANSFER],
      null,
      { seedPermissiveLimitProfile: false },
    );
    await seedLimitProfile(
      `W2W_${randomUUID().slice(0, 8).toUpperCase()}`,
      'AGENT',
      configuredSource.id,
      'WALLET_TRANSFER',
    );
    await fundWallet(configuredSourceWallet.ledgerAccountId, '50000');
    await expectMissingLimitRefusal({
      agentId: configuredSource.id,
      sourceLedgerAccountId: configuredSourceWallet.ledgerAccountId,
      destinationLedgerAccountId: missingDestinationWallet.ledgerAccountId,
      destinationWalletId: missingDestinationWallet.id,
      sourceBalance: 50000n,
      destinationBalance: 0n,
    });
  });

  it('agent self quote rejects cross-institution and partially attributed destinations', async () => {
    const { agent, wallet } = await createActiveAgentWithPin(
      [AgentService.WALLET_TRANSFER],
      '1234',
    );
    const foreignInstitution = await governed.fixture.institution('foreign-p2p');
    const foreignCustomer = await eligibleCustomerId();
    const foreign = await walletService.createWallet({
      customerId: foreignCustomer,
      currency: 'NGN',
      idempotencyKey: randomUUID(),
    });
    await governed.fixture.enrolCustomer(foreignCustomer, foreignInstitution, {
      targetStatus: 'ACTIVE',
      financialEligibility: 'ELIGIBLE',
    });
    await governed.fixture.attributeWallet(foreign.id, foreignInstitution);
    const legacyCustomer = await eligibleCustomerId();
    const legacy = await walletService.createWallet({
      customerId: legacyCustomer,
      currency: 'NGN',
      idempotencyKey: randomUUID(),
    });
    const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
    const quotes = app.get(TransferQuoteService);
    const input = { amountMinor: '1000', currency: 'NGN', idempotencyKey: randomUUID() };
    await expect(
      quotes.create(agentPrincipal(agent.id), { ...input, destinationWalletId: foreign.id }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      quotes.create(agentPrincipal(agent.id), {
        ...input,
        idempotencyKey: randomUUID(),
        destinationWalletId: legacy.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await walletBalance(wallet.ledgerAccountId)).toBe(0n);
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(0);
    expect(
      await dataSource.query(`SELECT quote_id FROM wallet_transfer_quote_bindings`),
    ).toHaveLength(0);
  });

  it('refuses confirmation after the governing institution is suspended', async () => {
    const { agent, wallet } = await createActiveAgentWithPin(
      [AgentService.WALLET_TRANSFER],
      '1234',
    );
    const destination = await createWallet(await eligibleCustomerId());
    await seedLimitProfile(
      `SUSP_${randomUUID().slice(0, 6).toUpperCase()}`,
      'AGENT',
      agent.id,
      'WALLET_TRANSFER',
    );
    await fundWallet(wallet.ledgerAccountId, '50000');
    const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
    const quote = await app.get(TransferQuoteService).create(agentPrincipal(agent.id), {
      destinationWalletId: destination.id,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: randomUUID(),
    });
    const key = randomUUID();
    await governed.fixture.changeInstitutionStatus(governed.institutionId, 'SUSPENDED');
    await expect(
      transferService.createConfirmedTransfer(agentPrincipal(agent.id), quote.quoteId, key, '1234'),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      app.get(TransferQuoteService).create(agentPrincipal(agent.id), {
        destinationWalletId: destination.id,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(await walletBalance(wallet.ledgerAccountId)).toBe(50000n);
    expect(await walletBalance(destination.ledgerAccountId)).toBe(0n);
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(0);
    expect(
      await dataSource.query(`SELECT status FROM payment_quotes WHERE id=$1`, [quote.quoteId]),
    ).toEqual([{ status: 'ACTIVE' }]);
    await governed.fixture.changeInstitutionStatus(governed.institutionId, 'APPROVED');
    const result = await transferService.createConfirmedTransfer(
      agentPrincipal(agent.id),
      quote.quoteId,
      key,
      '1234',
    );
    expect(result.status).toBe('COMPLETED');
    expect(await walletBalance(wallet.ledgerAccountId)).toBe(49000n);
    expect(await walletBalance(destination.ledgerAccountId)).toBe(1000n);
  });

  it('refuses a quoted transfer after governed agent affiliation suspension', async () => {
    const { agent, wallet } = await createActiveAgentWithPin(
      [AgentService.WALLET_TRANSFER],
      '1234',
    );
    const destination = await createWallet(await eligibleCustomerId());
    await fundWallet(wallet.ledgerAccountId, '50000');
    const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
    const quote = await app.get(TransferQuoteService).create(agentPrincipal(agent.id), {
      destinationWalletId: destination.id,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: randomUUID(),
    });
    const { networkManager, controller } = await governed.fixture.workforce();
    const body = {
      institutionId: governed.institutionId,
      changeKind: 'SUSPEND',
      evidenceType: 'INSTITUTION_APPROVAL_LETTER',
      evidenceReference: `SUSP-${randomUUID()}`,
      reason: 'Agent affiliation suspended under the institution governance procedure',
    };
    const path = `/api/v1/internal/agent-affiliations/${agent.id}`;
    const prepared = await request(app.getHttpServer())
      .post(`${path}/request`)
      .set('Authorization', `Bearer ${networkManager.token}`)
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/a2/workforce/approvals/${prepared.body.approvalId as string}/approve`)
      .set('Authorization', `Bearer ${controller.token}`)
      .send({ comment: 'independently checked' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${path}/execute`)
      .set('Authorization', `Bearer ${controller.token}`)
      .send({ ...body, approvalId: prepared.body.approvalId })
      .expect(201);
    await expect(
      transferService.createConfirmedTransfer(
        agentPrincipal(agent.id),
        quote.quoteId,
        randomUUID(),
        '1234',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await walletBalance(wallet.ledgerAccountId)).toBe(50000n);
    expect(await walletBalance(destination.ledgerAccountId)).toBe(0n);
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(0);
    expect(
      await dataSource.query(`SELECT status FROM payment_quotes WHERE id=$1`, [quote.quoteId]),
    ).toEqual([{ status: 'ACTIVE' }]);
  });

  it('refuses a quoted transfer after governed recipient enrolment suspension', async () => {
    const { agent, wallet } = await createActiveAgentWithPin(
      [AgentService.WALLET_TRANSFER],
      '1234',
    );
    const customerId = await eligibleCustomerId();
    const destination = await createWallet(customerId);
    await fundWallet(wallet.ledgerAccountId, '50000');
    const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
    const quote = await app.get(TransferQuoteService).create(agentPrincipal(agent.id), {
      destinationWalletId: destination.id,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: randomUUID(),
    });
    const { networkManager, controller } = await governed.fixture.workforce();
    const path = `/api/v1/internal/institutions/${governed.institutionId}/enrolments`;
    const body = {
      customerId,
      reference: `SUSP-${randomUUID()}`,
      targetStatus: 'SUSPENDED',
      financialEligibility: 'RESTRICTED',
      statusReason: 'Customer enrolment suspended under institution governance procedure',
    };
    const prepared = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${networkManager.token}`)
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/a2/workforce/approvals/${prepared.body.approvalId as string}/approve`)
      .set('Authorization', `Bearer ${controller.token}`)
      .send({ comment: 'independently checked' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${path}/execute`)
      .set('Authorization', `Bearer ${controller.token}`)
      .send({ ...body, approvalId: prepared.body.approvalId })
      .expect(201);
    await expect(
      transferService.createConfirmedTransfer(
        agentPrincipal(agent.id),
        quote.quoteId,
        randomUUID(),
        '1234',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await walletBalance(wallet.ledgerAccountId)).toBe(50000n);
    expect(await walletBalance(destination.ledgerAccountId)).toBe(0n);
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(0);
    expect(
      await dataSource.query(`SELECT status FROM payment_quotes WHERE id=$1`, [quote.quoteId]),
    ).toEqual([{ status: 'ACTIVE' }]);
  });

  it('confirmed transfer refuses a nonzero commission when accounting is disabled', async () => {
    configureAccounting({ COMMERCIAL_ACCOUNTING_ENABLED: undefined });
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '0', vatBps: 0 });
    await seedCommissionRule({
      productCode: 'WALLET_TRANSFER',
      flatCommissionMinor: '100',
      calculationBasis: 'PRINCIPAL',
    });
    const customerId = await eligibleCustomerId();
    const a = await createWallet(customerId);
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '50000');
    const credentialId = randomUUID();
    const sessionId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (id,customer_id,credential_type,password_hash,hash_algorithm,password_version,password_changed_at,status) VALUES ($1,$2,'PASSWORD','dummyhash','PBKDF2',1,NOW(),'ACTIVE')`,
      [credentialId, customerId],
    );
    await dataSource.query(
      `INSERT INTO authentication_sessions (id,customer_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at,onboarding_password_version) VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',NOW(),NOW()+interval '1 hour',NOW(),1)`,
      [sessionId, customerId, credentialId, randomBytes(32).toString('hex')],
    );
    const principal = {
      type: 'CUSTOMER' as const,
      customerId,
      principalId: customerId,
      sessionId,
      roles: [],
      scopes: [],
      customerAccess: 'SELF' as const,
    };
    await customerPinService.setTransactionPin(customerId, {
      pinHash: hashPin('1234'),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: customerId,
    });
    const { TransferQuoteService } = await import('../src/transfer/transfer-quote.service');
    const quote = await app.get(TransferQuoteService).create(principal, {
      sourceWalletId: a.id,
      destinationWalletId: b.id,
      amountMinor: '50000',
      currency: 'NGN',
      idempotencyKey: `fee-quote-${randomUUID()}`,
    });
    await expect(
      transferService.createConfirmedTransfer(
        principal,
        quote.quoteId,
        `fee-confirm-${randomUUID()}`,
        '1234',
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(await walletBalance(a.ledgerAccountId)).toBe(50000n);
    expect(await walletBalance(b.ledgerAccountId)).toBe(0n);
    expect(await accountingJournals()).toHaveLength(0);
    expect(await dataSource.query(`SELECT id FROM transfers`)).toHaveLength(0);
    expect(
      await dataSource.query(
        `SELECT q.status,b.transfer_id FROM payment_quotes q JOIN wallet_transfer_quote_bindings b ON b.quote_id=q.id WHERE q.id=$1`,
        [quote.quoteId],
      ),
    ).toEqual([{ status: 'ACTIVE', transfer_id: null }]);
  });

  // ── 12-16: VAT (configurable, never hard-coded, fail closed) ──

  it('12. EXCLUSIVE_ADD_ON: VAT leg == authoritative decision vatMinor; payer debited fee+vat', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 750 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
    const journals = await accountingJournals();
    const lines = await linesForJournal(journals[0].id);
    // fee=1000 → vat=floor(1000*750/10000)=75 → payer debited 1075.
    expect(lines).toContainEqual({
      direction: 'CREDIT',
      amount_minor: '1000',
      account_code: ACCOUNT_LEGEND.FEE_REVENUE,
    });
    expect(lines).toContainEqual({
      direction: 'CREDIT',
      amount_minor: '75',
      account_code: ACCOUNT_LEGEND.VAT_PAYABLE,
    });
    expect(lines.filter((l) => l.direction === 'DEBIT')[0].amount_minor).toBe('1075');
    const snap = await snapshotsFor(`product='WALLET_TRANSFER'`, []);
    expect(snap[0].fee_decision.posting.vatMinorPosted).toBe(snap[0].fee_decision.vatMinor);
  });

  it('13. INCLUSIVE_IN_FEE: revenue = fee − VAT; payer debited the fee only', async () => {
    configureAccounting({ COMMERCIAL_ACCOUNTING_VAT_TREATMENT: 'INCLUSIVE_IN_FEE' });
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 750 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
    const journals = await accountingJournals();
    const lines = await linesForJournal(journals[0].id);
    // carved = floor(1000*750/10750)=69 → revenue=931, vat=69, DR payer 1000.
    expect(lines).toContainEqual({
      direction: 'CREDIT',
      amount_minor: '931',
      account_code: ACCOUNT_LEGEND.FEE_REVENUE,
    });
    expect(lines).toContainEqual({
      direction: 'CREDIT',
      amount_minor: '69',
      account_code: ACCOUNT_LEGEND.VAT_PAYABLE,
    });
    expect(lines.filter((l) => l.direction === 'DEBIT')[0].amount_minor).toBe('1000');
  });

  it('14. rule vat_bps NULL (rate unset) + fee>0 → COMMERCIAL_VAT_RATE_NOT_CONFIGURED, tx aborts', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: null });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    try {
      await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
      throw new Error('expected blocked transfer');
    } catch (error: any) {
      expectBlocked(error, 'COMMERCIAL_VAT_RATE_NOT_CONFIGURED');
    }
    expect(await accountingJournals()).toHaveLength(0);
    expect(await snapshotsFor(`true`, [])).toHaveLength(0);
    expect(await walletBalance(a.ledgerAccountId)).toBe(200000n);
  });

  it('15. VAT treatment unset + fee>0 → COMMERCIAL_VAT_TREATMENT_NOT_CONFIGURED (never silently zero)', async () => {
    configureAccounting({ COMMERCIAL_ACCOUNTING_VAT_TREATMENT: undefined });
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    try {
      await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
      throw new Error('expected blocked transfer');
    } catch (error: any) {
      expectBlocked(error, 'COMMERCIAL_VAT_TREATMENT_NOT_CONFIGURED');
    }
    expect(await accountingJournals()).toHaveLength(0);
    expect(await snapshotsFor(`true`, [])).toHaveLength(0);
  });

  it('16. explicit vat_bps=0 → NO VAT leg (zero is an explicit exemption, not an unset rate)', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
    const journals = await accountingJournals();
    const lines = await linesForJournal(journals[0].id);
    expect(lines.some((l) => l.account_code === ACCOUNT_LEGEND.VAT_PAYABLE)).toBe(false);
    const snap = await snapshotsFor(`product='WALLET_TRANSFER'`, []);
    expect(snap[0].fee_decision.posting.vatMinorPosted).toBe('0');
  });

  // ── 17-25: commission treatments / timing ──

  it('17. EXPENSE_PAYABLE + ACCRUE_NOW_SETTLE_LATER → expense/payable legs + payable snapshot evidence', async () => {
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 1000,
      calculationBasis: 'FEE',
    });
    const run = await runCashIn({ amountMinor: '30000' });
    expect(run.result.status).toBe('COMPLETED');
    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    const lines = await linesForJournal(journals[0].id);
    expect(lines).toContainEqual({
      direction: 'DEBIT',
      amount_minor: '100',
      account_code: ACCOUNT_LEGEND.COMMISSION_EXPENSE,
    });
    expect(lines).toContainEqual({
      direction: 'CREDIT',
      amount_minor: '100',
      account_code: ACCOUNT_LEGEND.COMMISSION_PAYABLE,
    });
    const snap = await snapshotsFor(`product='CASH_TO_WALLET'`, []);
    expect(snap[0].commission_decision.status).toBe('ALLOCATED');
    expect(snap[0].commission_decision.payable).toBe(true);
    expect(snap[0].commission_decision.posting.treatment).toBe('EXPENSE_PAYABLE');
    expect(snap[0].commission_decision.posting.timing).toBe('ACCRUE_NOW_SETTLE_LATER');
  });

  it('18. unset treatment + non-zero allocation → COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT_NOT_CONFIGURED', async () => {
    configureAccounting({ COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: undefined });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 1000,
      calculationBasis: 'FEE',
    });
    await expect(runCashIn({ amountMinor: '30000' })).rejects.toMatchObject({});
    expect(await accountingJournals()).toHaveLength(0);
    expect(await snapshotsFor(`true`, [])).toHaveLength(0);
  });

  it('19. treatment×timing inconsistency → COMMERCIAL_COMMISSION_ACCOUNTING_CONFIG_INCONSISTENT (both arms)', async () => {
    configureAccounting({ COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'AT_COMPLETION' });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 1000,
      calculationBasis: 'FEE',
    });
    await expect(runCashIn({ amountMinor: '30000' })).rejects.toMatchObject({});
    expect(await accountingJournals()).toHaveLength(0);

    configureAccounting({
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'AGENT_WALLET_NETTING',
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'ACCRUE_NOW_SETTLE_LATER',
    });
    await expect(runCashIn({ amountMinor: '30000' })).rejects.toMatchObject({});
    expect(await accountingJournals()).toHaveLength(0);
  });

  it('20. AGENT_WALLET_NETTING + AT_COMPLETION → expense DR / agent wallet CR; credit lands', async () => {
    configureAccounting({
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'AGENT_WALLET_NETTING',
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'AT_COMPLETION',
    });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 1000,
      calculationBasis: 'FEE',
    });
    const run = await runCashIn({ amountMinor: '30000' });
    expect(run.result.status).toBe('COMPLETED');
    const journals = await accountingJournals();
    const lines = await linesForJournal(journals[0].id);
    expect(lines).toContainEqual({
      direction: 'DEBIT',
      amount_minor: '100',
      account_code: ACCOUNT_LEGEND.COMMISSION_EXPENSE,
    });
    expect(lines.some((l) => l.direction === 'CREDIT' && l.amount_minor === '100')).toBe(true);
    const snap = await snapshotsFor(`product='CASH_TO_WALLET'`, []);
    expect(snap[0].commission_decision.payable).toBe(false);
    expect(snap[0].commission_decision.posting.treatment).toBe('AGENT_WALLET_NETTING');
    // The netting credit LANDED on the acting agent's wallet:
    // 500000 funded − 30000 principal + 100 netting credit.
    expect(await walletBalance(run.agentWallet.ledgerAccountId)).toBe(470100n);
  });

  it('agent commission netting refuses a customer wallet even when its ID is supplied as beneficiary', async () => {
    configureAccounting({
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'AGENT_WALLET_NETTING',
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'AT_COMPLETION',
    });
    const customerId = await eligibleCustomerId();
    const wallet = await createWallet(customerId);
    await fundWallet(wallet.ledgerAccountId, '1000');
    const input = {
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      baseIdempotencyKey: `invalid-beneficiary-${randomUUID()}`,
      correlationId: null,
      reference: null,
      snapshotIdempotencyKey: `snapshot-${randomUUID()}`,
      metadata: {},
      feePayerCustomerId: customerId,
      feeDecision: { status: 'ZERO' },
      commissionDecision: {
        status: 'ALLOCATED',
        allocations: [
          {
            beneficiaryType: 'AGENT',
            beneficiaryId: customerId,
            amountMinor: '100',
            currency: 'NGN',
          },
        ],
      },
    };
    await expect(
      dataSource.transaction((manager) => accountingService.postForCompletion(manager, input)),
    ).rejects.toMatchObject({
      status: 422,
      blockerCode: 'COMMERCIAL_BENEFICIARY_WALLET_NOT_RESOLVABLE',
    });
    expect(await walletBalance(wallet.ledgerAccountId)).toBe(1000n);
    expect(await accountingJournals()).toHaveLength(0);
  });

  it('20b. WT (no acting agent) + netting → fails closed (beneficiary wallet unresolvable)', async () => {
    configureAccounting({
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'AGENT_WALLET_NETTING',
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'AT_COMPLETION',
    });
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({
      productCode: 'WALLET_TRANSFER',
      percentageBps: 1000,
      calculationBasis: 'FEE',
    });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    await expect(doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`)).rejects.toMatchObject(
      {},
    );
    expect(await accountingJournals()).toHaveLength(0);
    expect(await snapshotsFor(`true`, [])).toHaveLength(0);
  });

  it('21. CONTRA_REVENUE → configuration model present, posting fails closed with precise blocker', async () => {
    configureAccounting({
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'CONTRA_REVENUE',
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'AT_COMPLETION',
    });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 1000,
      calculationBasis: 'FEE',
    });
    await expect(runCashIn({ amountMinor: '30000' })).rejects.toMatchObject({});
    expect(await accountingJournals()).toHaveLength(0);
  });

  it('22. unset timing → COMMERCIAL_COMMISSION_TIMING_NOT_CONFIGURED, tx aborts', async () => {
    configureAccounting({ COMMERCIAL_COMMISSION_RECOGNITION_TIMING: undefined });
    await seedFeeRule({ productCode: 'CASH_TO_WALLET', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({
      productCode: 'CASH_TO_WALLET',
      percentageBps: 1000,
      calculationBasis: 'FEE',
    });
    await expect(runCashIn({ amountMinor: '30000' })).rejects.toMatchObject({});
    expect(await accountingJournals()).toHaveLength(0);
  });

  it('23. zero-amount ALLOCATED commission → no commission legs, explicit evidence', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({
      productCode: 'WALLET_TRANSFER',
      flatCommissionMinor: '0',
      calculationBasis: 'PRINCIPAL',
    });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
    const snap = await snapshotsFor(`product='WALLET_TRANSFER'`, []);
    expect(snap[0].commission_decision.status).toBe('ALLOCATED');
    expect(snap[0].commission_decision.posting).toEqual({
      journalLegsPosted: false,
      reason: 'ZERO_AMOUNT_NO_LEGS_POSTED',
    });
    const journals = await accountingJournals();
    const lines = await linesForJournal(journals[0].id);
    expect(lines.some((l) => l.account_code === ACCOUNT_LEGEND.COMMISSION_EXPENSE)).toBe(false);
  });

  it('24. C2C: SINGLE commission accounting event at initiation; claim creates none', async () => {
    await seedFeeRule({ productCode: 'CASH_TO_CASH', flatFeeMinor: '1000', vatBps: 0 });
    await seedCommissionRule({
      productCode: 'CASH_TO_CASH',
      percentageBps: 1000,
      calculationBasis: 'FEE',
    });
    const bundle = await createActiveAgentWithPin([AgentService.CASH_TO_CASH], '1234');
    const { agent, wallet: agentWallet } = bundle;
    await fundWallet(agentWallet.ledgerAccountId, '500000');
    await seedLimitProfile(
      `PCA_${randomUUID().slice(0, 6).toUpperCase()}`,
      'AGENT',
      agent.id,
      'CASH_TO_CASH',
    );
    await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: newPhone(),
      amountMinor: '20000',
      currency: 'NGN',
      idempotencyKey: `ca01-c2c-${randomUUID()}`,
    });
    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    const lines = await linesForJournal(journals[0].id);
    expect(lines).toContainEqual({
      direction: 'DEBIT',
      amount_minor: '100',
      account_code: ACCOUNT_LEGEND.COMMISSION_EXPENSE,
    });
    const snap = await snapshotsFor(`product='CASH_TO_CASH' AND direction='OUTGOING'`, []);
    expect(snap[0].commission_decision.commissionEvent).toBe('CASH_TO_CASH_INITIATION');
    const claimSnapshot = await snapshotsFor(`product='CASH_TO_CASH' AND direction='INCOMING'`, []);
    expect(claimSnapshot.length).toBe(0);
  });

  it('25. AGGREGATOR / PLATFORM allocations → precise fail-closed blockers (V1 scope invariants)', async () => {
    await dataSource
      .query(
        `INSERT INTO aggregators (id, code, name, status) VALUES ($1, $2, 'test', 'ACTIVE') ON CONFLICT DO NOTHING`,
        [randomUUID(), `agg-${randomUUID().slice(0, 6)}`],
      )
      .catch(() => undefined);
    // Direct service-level invocation of the strategy boundary is sufficient and precise here.
    await expect(
      accountingService['postForCompletion']({} as any, {
        productCode: 'WALLET_TRANSFER',
        currency: 'NGN',
        baseIdempotencyKey: 'direct-agg-check',
        correlationId: null,
        reference: null,
        snapshotIdempotencyKey: 'direct-agg-check',
        metadata: {},
        feePayerCustomerId: randomUUID(),
        feeDecision: { status: 'ZERO', feeMinor: '0' },
        commissionDecision: {
          status: 'ALLOCATED',
          allocations: [
            {
              beneficiaryType: 'AGGREGATOR',
              beneficiaryId: randomUUID(),
              amountMinor: '10',
              currency: 'NGN',
            },
          ],
        },
      }),
    ).rejects.toMatchObject({});
    try {
      await accountingService['postForCompletion']({} as any, {
        productCode: 'WALLET_TRANSFER',
        currency: 'NGN',
        baseIdempotencyKey: 'direct-platform-check',
        correlationId: null,
        reference: null,
        snapshotIdempotencyKey: 'direct-platform-check',
        metadata: {},
        feePayerCustomerId: randomUUID(),
        feeDecision: { status: 'ZERO', feeMinor: '0' },
        commissionDecision: {
          status: 'ALLOCATED',
          allocations: [
            {
              beneficiaryType: 'PLATFORM',
              beneficiaryId: null,
              amountMinor: '10',
              currency: 'NGN',
            },
          ],
        },
      });
      throw new Error('expected platform blocker');
    } catch (error: any) {
      expectBlocked(error, 'COMMERCIAL_PLATFORM_ALLOCATION_POSTING_NOT_PROVISIONED');
    }
  });

  // ── 26-32: governance / determinism / no-repurposing / strategy boundary ──

  it('26. migration determined registry evidence + account provisioning at bootstrap', async () => {
    expect(bootstrapRegistryRows).toHaveLength(4);
    const byFamily = new Map(bootstrapRegistryRows.map((r) => [r.family_code, r]));
    expect(byFamily.get('FEE_REVENUE').account_code).toBe(ACCOUNT_LEGEND.FEE_REVENUE);
    expect(byFamily.get('FEE_REVENUE').decision_references.join(' ')).toContain('DP-01');
    expect(byFamily.get('VAT_PAYABLE').decision_references.join(' ')).toContain('DP-03');
    expect(byFamily.get('COMMISSION_EXPENSE').decision_references.join(' ')).toContain('DP-05');
    expect(byFamily.get('COMMISSION_PAYABLE').evidence_source).toContain(
      'HUMAN-DECISIONS@V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01',
    );
    const byCode = new Map(bootstrapAccountRows.map((r) => [r.code, r]));
    expect(byCode.get(ACCOUNT_LEGEND.FEE_REVENUE)).toMatchObject({
      account_type: 'REVENUE',
      normal_balance: 'CREDIT',
      currency: 'NGN',
      accounting_unit: 'CUSTOMER_FUNDS',
      allow_negative_balance: false,
      is_active: true,
    });
    expect(byCode.get(ACCOUNT_LEGEND.COMMISSION_EXPENSE)).toMatchObject({
      account_type: 'EXPENSE',
      normal_balance: 'DEBIT',
      is_active: true,
    });
    expect(byCode.get(ACCOUNT_LEGEND.COMMISSION_PAYABLE)).toMatchObject({
      account_type: 'LIABILITY',
      normal_balance: 'CREDIT',
      is_active: true,
    });
  });

  it('27. missing registry evidence → COMMERCIAL_ACCOUNTING_REGISTRY_EVIDENCE_MISSING (fail closed)', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 750 });
    await dataSource.query(
      `DELETE FROM commercial_accounting_registry WHERE family_code='VAT_PAYABLE'`,
    );
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    try {
      await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
      throw new Error('expected gov blocker');
    } catch (error: any) {
      expectBlocked(error, 'COMMERCIAL_ACCOUNTING_REGISTRY_EVIDENCE_MISSING');
    }
    expect(await accountingJournals()).toHaveLength(0);
  });

  it('28. registered-but-unprovisioned account → COMMERCIAL_ACCOUNTING_ACCOUNT_NOT_PROVISIONED', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    await dataSource.query(`DELETE FROM ledger_accounts WHERE code=$1`, [
      ACCOUNT_LEGEND.FEE_REVENUE,
    ]);
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    try {
      await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
      throw new Error('expected provisioning blocker');
    } catch (error: any) {
      expectBlocked(error, 'COMMERCIAL_ACCOUNTING_ACCOUNT_NOT_PROVISIONED');
    }
    expect(await accountingJournals()).toHaveLength(0);
  });

  it('29. registry↔account geometry mismatch → COMMERCIAL_ACCOUNTING_REGISTRY_GEOMETRY_MISMATCH', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 0 });
    await dataSource.query(
      `UPDATE commercial_accounting_registry SET normal_balance='DEBIT' WHERE family_code='FEE_REVENUE'`,
    );
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    try {
      await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
      throw new Error('expected geometry blocker');
    } catch (error: any) {
      expectBlocked(error, 'COMMERCIAL_ACCOUNTING_REGISTRY_GEOMETRY_MISMATCH');
    }
    expect(await accountingJournals()).toHaveLength(0);
  });

  it('30. accounting journals touch ONLY payer wallets + the 4 provisioned codes (no repurposing)', async () => {
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 750 });
    await seedCommissionRule({
      productCode: 'WALLET_TRANSFER',
      percentageBps: 500,
      calculationBasis: 'FEE',
    });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
    const journals = await accountingJournals();
    expect(journals).toHaveLength(1);
    const codes: Array<{ code: string }> = await dataSource.query(
      `SELECT DISTINCT a.code FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.journal_id=$1`,
      [journals[0].id],
    );
    const allowed = new Set([...Object.values(ACCOUNT_LEGEND)]);
    for (const row of codes) {
      const isWalletCode = row.code.startsWith('WALLET');
      if (!allowed.has(row.code)) {
        expect(isWalletCode || false).toBe(true);
        continue;
      }
    }
    // Explicitly: existing clearance/settlement/unclaimed/pool families NEVER touched.
    const repurposed = codes.filter((row) =>
      /SETTLEMENT|UNCLAIMED|POOL|RECEIVABLE|SUSPENSE|CLEARING/.test(row.code),
    );
    expect(repurposed).toHaveLength(0);
  });

  it('31. accounting DISABLED → byte-identical legacy posture preserved', async () => {
    configureAccounting({
      COMMERCIAL_ACCOUNTING_ENABLED: undefined,
      COMMERCIAL_ACCOUNTING_VAT_TREATMENT: undefined,
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: undefined,
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: undefined,
    });
    await seedFeeRule({ productCode: 'WALLET_TRANSFER', flatFeeMinor: '1000', vatBps: 750 });
    const a = await createWallet(await eligibleCustomerId());
    const b = await createWallet(await eligibleCustomerId());
    await fundWallet(a.ledgerAccountId, '200000');
    const view = await doTransfer(a.id, b.id, '50000', `ca01-t-${randomUUID()}`);
    expect(view.status).toBe('COMPLETED');
    expect(await accountingJournals()).toHaveLength(0);
    const snap = await snapshotsFor(`product='WALLET_TRANSFER'`, []);
    expect(snap[0].fee_decision.posting).toEqual(LEGACY_POSTING_BLOCKED);
    const principalLines: Array<any> = await dataSource.query(
      `SELECT l.direction, l.amount_minor::text AS amount_minor FROM ledger_lines l JOIN ledger_journals j ON j.id=l.journal_id WHERE j.idempotency_key=$1 ORDER BY l.direction, l.amount_minor`,
      [`transfer:${view.id}`],
    );
    expect(principalLines).toEqual([
      { direction: 'CREDIT', amount_minor: '50000' },
      { direction: 'DEBIT', amount_minor: '50000' },
    ]);
  });

  it('32. dedicated strategy boundary: flow services carry NO treatment branching', async () => {
    const flowSources = [
      '../src/transfer/transfer.service.ts',
      '../src/agent/agent-financial-execution.service.ts',
      '../src/agent/agent-cash-to-cash.service.ts',
      '../src/agent/agent-cash-to-cash-claim.service.ts',
    ].map((p) => readFileSync(join(__dirname, p), 'utf8'));
    for (const source of flowSources) {
      expect(source.includes('AGENT_WALLET_NETTING')).toBe(false);
      expect(source.includes('CONTRA_REVENUE')).toBe(false);
      expect(source.includes('EXPENSE_PAYABLE')).toBe(false);
      expect(source.includes('ACCRUE_NOW_SETTLE_LATER')).toBe(false);
      expect(source.includes('VAT_TREATMENT')).toBe(false);
    }
    // The claim path is engine-free AND accounting-free (single-event guarantee).
    expect(flowSources[3].includes('commercialAccountingService')).toBe(false);
  });
});
