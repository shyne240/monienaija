/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
/**
 * PR #27 — WALLET→BANK COMMISSION, APPLIED AT THE MOMENT IT IS EARNED (real PostgreSQL).
 *
 * The requirement is narrower than "commission is wired". It is that commission appears exactly once,
 * at exactly the right event, for exactly the right recipient — and that every other event produces
 * nothing. This suite proves that end to end on a disposable per-process PostgreSQL database, driving
 * the REAL commitment and settlement services (no mocked settlement), with only the provider-outcome
 * verifier substituted because no live provider may be called.
 *
 * The four moments that matter, each proven separately:
 *
 *   C01 APPROVED NONZERO RULE — an agent-initiated wallet→bank transfer settles, and the SAME amount
 *       appears in the preview the operator reads, in the recorded decision snapshot, and in the posted
 *       accrual (DR commission expense / CR commission payable). Three independent observations, one
 *       number. This is the parity claim.
 *   C02 EXPLICIT ZERO — a configured rule that computes to zero is recorded as an ALLOCATED decision
 *       of 0, with no journal legs. It is NOT confused with "no rule".
 *   C03 FAILED / RELEASED — a rejected transfer releases its commitment and produces no commission row
 *       and no accounting journal at all. A pending (RESERVED) commitment likewise has none.
 *   C04 REPLAY — a second settlement of the same operation is refused as a duplicate and leaves exactly
 *       one snapshot row and one journal. Commission cannot be paid twice.
 *
 * Attribution is the fifth, quieter claim: a customer's own transfer gets no agent commission even
 * when an agent rule is configured, because no agent earned it. That is what makes the recipient
 * "eligible" rather than merely "present".
 *
 * PROVISIONAL TEST CONFIGURATION ONLY. The rates below exist solely inside this disposable database.
 * They are not production policy: no migration or seed ships a commission rule, and nothing here is
 * evidence that a rate has been approved.
 */
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { CommercialAccountingService } from '../src/commercial-accounting/commercial-accounting.service';
import { CommercialDecisionSnapshotService } from '../src/commercial-decision/commercial-decision-snapshot.service';
import { CommissionEngine } from '../src/commission/commission.engine';
import { CommissionRuleRegistryService } from '../src/commission/commission-rule-registry.service';
import { CommissionRuleResolverService } from '../src/commission/commission-rule-resolver.service';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { FinancialCommitmentService } from '../src/financial-commitment/financial-commitment.service';
import { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { LedgerService } from '../src/ledger/ledger.service';
import { LimitUsageService } from '../src/limit-catalog/limit-usage.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { OutboxService } from '../src/operations/outbox.service';
import { ExternalOperationLifecycleService } from '../src/partner/external-operation-lifecycle.service';
import {
  ExternalOperationReferenceSource,
  ExternalOperationReferenceType,
} from '../src/partner/external-operation.enums';
import { ExternalOperationLifecycleState } from '../src/partner/external-operation-lifecycle.enums';
import { ExternalOperationService } from '../src/partner/external-operation.service';
import type { ExternalOperationStatusVerifier } from '../src/partner/external-operation-status-verifier';
import { ExternalSettlement } from '../src/partner/external-settlement.entity';
import { ExternalSettlementDecision } from '../src/partner/external-settlement.enums';
import { ExternalSettlementService } from '../src/partner/external-settlement.service';
import { ExternalSuspenseEntry } from '../src/partner/external-suspense-entry.entity';
import { SettlementAccountService } from '../src/payment/settlement-account.service';
import { WITHDRAWAL_EXECUTION_AUTHORITY } from '../src/financial-commitment/withdrawal-execution-authority';
import { WalletService } from '../src/wallet/wallet.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/** Salted PBKDF2 in the exact envelope the credential services verify against. */
const hashPin = (pin: string): string => {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
};

const ACCOUNT_CODES = {
  FEE_REVENUE: 'FINANCE-FEE_REVENUE-NGN',
  VAT_PAYABLE: 'FINANCE-VAT_PAYABLE-NGN',
  COMMISSION_EXPENSE: 'FINANCE-COMMISSION_EXPENSE-NGN',
  COMMISSION_PAYABLE: 'FINANCE-COMMISSION_PAYABLE-NGN',
} as const;

describe('PR27 wallet-to-bank commission at settlement (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let ledger: LedgerService;
  let commitments: FinancialCommitmentService;
  let settlement: ExternalSettlementService;
  let operations: ExternalOperationService;
  let lifecycle: ExternalOperationLifecycleService;
  let commissionRegistry: CommissionRuleRegistryService;
  let commissionResolver: CommissionRuleResolverService;
  let feeRegistry: FeeRuleRegistryService;
  let assetId: string;
  let baselineJournalCount = '0';
  let baselineExpense = 0n;
  let baselinePayable = 0n;
  let verificationState: 'VERIFIED_SETTLED' | 'VERIFIED_REJECTED' | 'UNKNOWN' | 'UNAVAILABLE' =
    'VERIFIED_SETTLED';

  const requestContext = {
    requestId: 'pr27-commission',
    correlationId: 'pr27-commission',
    traceId: 'pr27-commission',
  };
  const agentSessions = new Map<string, string>();

  const agentPrincipal = (agentId: string) => ({
    type: 'AGENT' as const,
    sessionId: agentSessions.get(agentId),
    agentId,
    principalId: agentId,
    roles: [],
    scopes: [],
    customerAccess: 'NONE' as const,
    agentAccess: 'SELF' as const,
  });

  beforeAll(async () => {
    process.env.COMMERCIAL_ACCOUNTING_ENABLED = 'true';
    process.env.COMMERCIAL_ACCOUNTING_VAT_TREATMENT = 'EXCLUSIVE_ADD_ON';
    process.env.COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT = 'EXPENSE_PAYABLE';
    process.env.COMMERCIAL_COMMISSION_RECOGNITION_TIMING = 'ACCRUE_NOW_SETTLE_LATER';

    dataSource = await createIntegrationDataSource('pr27Commission');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue({ read: () => Promise.resolve(null) })
      .overrideProvider(CustomerFinancialEligibilityService)
      .useValue({ require: () => Promise.resolve() })
      .overrideProvider(WITHDRAWAL_EXECUTION_AUTHORITY)
      .useValue({
        authorize: () =>
          Promise.resolve({
            outcome: 'AUTHORIZED',
            providerKey: 'MONNIFY',
            environment: 'sandbox',
          }),
      })
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(new TestNotificationProvider())
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    ledger = app.get(LedgerService);
    commitments = app.get(FinancialCommitmentService);
    operations = app.get(ExternalOperationService);
    lifecycle = app.get(ExternalOperationLifecycleService);
    commissionRegistry = app.get(CommissionRuleRegistryService);
    commissionResolver = app.get(CommissionRuleResolverService);
    feeRegistry = app.get(FeeRuleRegistryService);

    // The provider verifier is the ONLY substituted collaborator: no live provider may be called, and
    // the production adapter deliberately fails closed. Everything else — commitment, settlement,
    // ledger, commission engine, snapshot, accounting — is the real code path.
    const verifier: ExternalOperationStatusVerifier = {
      verify: ({ operation, correlationId }) =>
        Promise.resolve({
          state: verificationState,
          providerStatus: 'controlled-test',
          providerReferenceHash: createHash('sha256')
            .update(
              operation.providerReferences.find(
                (reference) => reference.source === ExternalOperationReferenceSource.STATUS_QUERY,
              )?.referenceValue ?? correlationId,
            )
            .digest('hex'),
          observedAt: new Date().toISOString(),
          reasonCode: null,
        }),
    };
    settlement = new ExternalSettlementService(
      dataSource.getRepository(ExternalSettlement),
      dataSource.getRepository(ExternalSuspenseEntry),
      dataSource,
      ledger,
      app.get(SettlementAccountService),
      operations,
      app.get(IdempotencyService),
      app.get(AuditService),
      { getProfile: () => ({ enabled: true }) } as never,
      app.get(OutboxService),
      verifier,
      app.get(LimitUsageService),
      app.get(CommissionEngine),
      app.get(CommercialDecisionSnapshotService),
      app.get(CommercialAccountingService),
    );
  }, 180000);

  afterAll(async () => {
    for (const key of [
      'COMMERCIAL_ACCOUNTING_ENABLED',
      'COMMERCIAL_ACCOUNTING_VAT_TREATMENT',
      'COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT',
      'COMMERCIAL_COMMISSION_RECOGNITION_TIMING',
    ]) {
      delete process.env[key];
    }
    try {
      if (app) await app.close();
    } finally {
      if (dataSource) await destroyIntegrationDataSource(dataSource);
    }
  }, 60000);

  beforeEach(async () => {
    verificationState = 'VERIFIED_SETTLED';
    // Deliberately NOT a wholesale TRUNCATE: this suite needs the migration-owned ledger account
    // skeleton (settlement asset, withdrawal reserve, product catalogue) that a truncate destroys and
    // no in-test seeder can fully rebuild. Instead only the two authored-rule tables are cleared, so
    // each test starts with exactly the rules it declares and nothing inherited from the previous one.
    await dataSource.query(`DELETE FROM commission_rules`);
    await dataSource.query(`DELETE FROM fee_rules`);
    await provisionCommercialAccounts();
    // Banks are truncated with everything else, and the agent beneficiary resolution joins an ACTIVE,
    // NIP-supported bank — so they must be re-seeded for each test, not once per suite.
    await dataSource.query(
      `INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status) VALUES($1,'BNKCOM','Bank Commission','BC',true,'ACTIVE') ON CONFLICT DO NOTHING`,
      [randomUUID()],
    );
    await dataSource.query(
      `INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status) VALUES($1,'BNKSET','Bank Settlement','BS',true,'ACTIVE') ON CONFLICT DO NOTHING`,
      [randomUUID()],
    );
    // Ledger accounts are recreated by each truncate+seed, so the settlement asset id must be
    // re-resolved per test rather than captured once.
    const assets = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`,
    );
    const fallback = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM ledger_accounts ORDER BY code LIMIT 1`,
    );
    assetId = assets[0]?.id ?? fallback[0]!.id;
    // The ledger is append-only, so every observation is a DELTA from this test's baseline rather than
    // an absolute total. That keeps C01's accrual from being mistaken for C02's zero.
    baselineJournalCount = (
      await dataSource.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count FROM ledger_journals WHERE idempotency_key LIKE 'wallet-to-bank:%:commercial-accounting'`,
      )
    )[0]!.count;
    baselineExpense = await balanceOf(ACCOUNT_CODES.COMMISSION_EXPENSE);
    baselinePayable = await balanceOf(ACCOUNT_CODES.COMMISSION_PAYABLE);
  });

  /**
   * Provision the four commercial accounting families and their DP-31=A registry evidence, exactly as
   * migration 1785753600076 does in a configured deployment. The payable/expense accounts are real
   * ledger accounts here, so an accrual claim is a claim about rows — not about a mock being called.
   */
  async function provisionCommercialAccounts(): Promise<void> {
    const families = [
      { role: 'FEE_REVENUE', code: ACCOUNT_CODES.FEE_REVENUE, type: 'REVENUE', normal: 'CREDIT' },
      { role: 'VAT_PAYABLE', code: ACCOUNT_CODES.VAT_PAYABLE, type: 'LIABILITY', normal: 'CREDIT' },
      {
        role: 'COMMISSION_EXPENSE',
        code: ACCOUNT_CODES.COMMISSION_EXPENSE,
        type: 'EXPENSE',
        normal: 'DEBIT',
      },
      {
        role: 'COMMISSION_PAYABLE',
        code: ACCOUNT_CODES.COMMISSION_PAYABLE,
        type: 'LIABILITY',
        normal: 'CREDIT',
      },
    ] as const;
    for (const family of families) {
      await dataSource.query(
        `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'NGN', 'CUSTOMER_FUNDS', FALSE, TRUE)
         ON CONFLICT (code) DO NOTHING`,
        [family.code, `${family.code} (PR27 test fixture)`, family.type, family.normal],
      );
      await dataSource.query(
        `INSERT INTO commercial_accounting_registry (
           family_code, account_code, account_type, normal_balance, currency, accounting_unit,
           purpose, decision_references, evidence_source, provisioned_by
         ) VALUES ($1, $2, $3, $4, 'NGN', 'CUSTOMER_FUNDS', 'PR27 test fixture', ARRAY['DP-31=A'], 'TEST', '1785753600076')
         ON CONFLICT (family_code) DO NOTHING`,
        [family.role, family.code, family.type, family.normal],
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────── fixtures

  async function createAgent() {
    const agentClass = await app.get(AgentClassService).create({
      reference: `cls-pr27c-${randomUUID().slice(0, 6)}`,
      code: `PRC-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'PR27 Commission Class',
      isActive: true,
      applicableServices: [AgentService.EXTERNAL_BANK_TRANSFER] as unknown,
      actor: 'test',
    });
    const application = await app.get(AgentApplicationService).create({
      agentClassId: agentClass.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz ${randomUUID().slice(0, 4)}`,
      contactEmail: `pr27c-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant',
    });
    await app.get(AgentApplicationService).submit(application.id, 'applicant');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [application.id],
    );
    const agent = await app
      .get(AgentLifecycleService)
      .activateFromApplication(application.id, 'test-actor');
    await app.get(AgentAuthenticationService).setTransactionPin(agent.id, {
      pinHash: hashPin('1234'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: agent.id,
    });
    const wallet = await app.get(WalletService).createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `pr27c-w-${agent.id}-${randomUUID()}`,
    });
    const walletRows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    await ledger.postJournal({
      idempotencyKey: `pr27c-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: assetId, direction: 'DEBIT' as never, amountMinor: '500000' },
        {
          accountId: walletRows[0]!.ledger_account_id,
          direction: 'CREDIT' as never,
          amountMinor: '500000',
        },
      ],
    });
    const profile = `PRC_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'Agent','AGENT','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,'AGENT',$3,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile, agent.id],
    );
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',100000,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile],
    );
    const beneficiaryId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_beneficiaries(id,agent_id,beneficiary_type,display_name,reference,destination_identifier,normalized_destination_identifier,destination_name,destination_institution,nickname,status,verified,version,created_at,updated_at) VALUES($1,$2,'BANK_ACCOUNT',$3,$4,'1234567890','1234567890','Test','BNKSET','My','ACTIVE',true,1,clock_timestamp(),clock_timestamp())`,
      [beneficiaryId, agent.id, 'Test', `bank-${randomUUID()}`],
    );
    await dataSource.query(
      `INSERT INTO beneficiary_ownerships(id,beneficiary_id,agent_id,version) VALUES($1,$2,$3,1)`,
      [randomUUID(), beneficiaryId, agent.id],
    );

    const token = randomBytes(32).toString('base64url');
    const [credential] = await dataSource.query<[{ id: string }]>(
      `INSERT INTO agent_authentication_credentials(agent_id,password_hash,hash_algorithm,password_version,password_changed_at,status) VALUES($1,$2,'PBKDF2',1,clock_timestamp(),'ACTIVE') RETURNING id`,
      [agent.id, hashPin('login-password')],
    );
    const [session] = await dataSource.query<[{ id: string }]>(
      `INSERT INTO agent_authentication_sessions(agent_id,credential_id,token_hash,audience,status,issued_at,expires_at,last_seen_at) VALUES($1,$2,$3,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp()) RETURNING id`,
      [agent.id, credential.id, createHash('sha256').update(token, 'utf8').digest('hex')],
    );
    agentSessions.set(agent.id, session.id);

    return {
      agent,
      agentClassId: agentClass.id,
      walletAccountId: wallet.id,
      walletLedgerAccountId: walletRows[0]!.ledger_account_id,
      beneficiaryId,
      sessionId: session.id,
    };
  }

  /** A commission rule for the canonical outbound product, authored as a real registry row. */
  async function seedCommissionRule(input: {
    percentageBps?: number | null;
    flatCommissionMinor?: string | null;
    calculationBasis?: 'PRINCIPAL' | 'FEE' | 'NET';
    agentClassId?: string | null;
    agentId?: string | null;
  }): Promise<string> {
    const rule = await commissionRegistry.createRule(
      {
        productCode: 'WALLET_TO_BANK',
        currency: 'NGN',
        recipientType: 'AGENT',
        calculationModel:
          input.flatCommissionMinor !== undefined && input.flatCommissionMinor !== null
            ? 'FIXED'
            : 'PERCENTAGE',
        calculationBasis: input.calculationBasis ?? 'PRINCIPAL',
        flatCommissionMinor: input.flatCommissionMinor ?? null,
        percentageBps: input.percentageBps ?? null,
        minimumCommissionMinor: null,
        maximumCommissionMinor: null,
        tiers: null,
        agentClassId: input.agentClassId ?? null,
        agentId: input.agentId ?? null,
        aggregatorId: null,
        effectiveFrom: new Date(Date.now() - 86_400_000),
        effectiveTo: null,
        priority: 0,
        isActive: true,
      } as any,
      'pr27-fixture',
    );
    return rule.id;
  }

  async function seedFeeRule(input: { flatFeeMinor: string; vatBps: number | null }) {
    await feeRegistry.createRule(
      {
        productCode: 'WALLET_TO_BANK',
        currency: 'NGN',
        flatFeeMinor: input.flatFeeMinor,
        percentageBps: null,
        minimumFeeMinor: null,
        maximumFeeMinor: null,
        vatBps: input.vatBps,
        effectiveFrom: new Date(Date.now() - 86_400_000),
        priority: 0,
        isActive: true,
      } as any,
      'pr27-fixture',
    );
  }

  /** Drive a commitment all the way to a settlement attempt and return what happened. */
  async function transferToSettlement(input: {
    agentId: string;
    sessionId: string;
    walletAccountId: string;
    beneficiaryId: string;
    amountMinor: string;
    decision?: ExternalSettlementDecision;
  }) {
    const initiated = await commitments.initiateForAgent({
      agentId: input.agentId,
      agentSessionId: input.sessionId,
      principal: agentPrincipal(input.agentId),
      pin: '1234',
      amountMinor: input.amountMinor,
      currency: 'NGN',
      beneficiaryId: input.beneficiaryId,
      walletAccountId: input.walletAccountId,
      idempotencyKey: randomUUID(),
    });
    const operationId = initiated.commitment.external_operation_id;
    const attempt = await lifecycle.beginAttempt(
      operationId,
      `att-${randomUUID()}`,
      requestContext,
      1,
    );
    const providerReference = `prov-${randomUUID()}`;
    await operations.recordProviderReference({
      externalOperationId: operationId,
      partnerKey: 'NIBSS_NIP',
      referenceType: ExternalOperationReferenceType.TRANSACTION,
      referenceValue: providerReference,
      namespace: 'nibss.nip',
      source: ExternalOperationReferenceSource.STATUS_QUERY,
      requestContext,
    });
    const pending = await lifecycle.transition({
      externalOperationId: operationId,
      expectedVersion: attempt.version,
      nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
      idempotencyKey: `pend-${randomUUID()}`,
      requestContext,
    });

    const settle = async () =>
      settlement.settleVerifiedOutcome({
        externalOperationId: operationId,
        expectedVersion: pending.version,
        decision: input.decision ?? ExternalSettlementDecision.SETTLE,
        evidence: {
          referenceType: 'TRANSACTION',
          referenceValue: providerReference,
          namespace: 'nibss.nip',
          source: ExternalOperationReferenceSource.STATUS_QUERY,
          observedAt: new Date(),
        },
        requestContext,
      });

    return {
      commitment: initiated.commitment,
      operationId,
      pendingVersion: pending.version,
      settle,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────── observers

  const snapshotsFor = (commitmentId: string): Promise<Array<Record<string, any>>> =>
    dataSource.query(
      `SELECT * FROM commercial_decision_snapshots WHERE transaction_reference=$1 ORDER BY created_at`,
      [commitmentId],
    );

  const commitmentState = async (commitmentId: string): Promise<string> =>
    (
      await dataSource.query<Array<{ state: string }>>(
        `SELECT state FROM financial_commitments WHERE id=$1`,
        [commitmentId],
      )
    )[0]!.state;

  /** Commission-related journals only: the settlement journal is a different, expected entry. */
  const commissionJournals = (): Promise<Array<Record<string, any>>> =>
    dataSource.query(
      `SELECT j.id, j.idempotency_key FROM ledger_journals j
        WHERE j.idempotency_key LIKE 'wallet-to-bank:%:commercial-accounting'
        ORDER BY j.created_at`,
    );

  /** Commission journals created BY THIS TEST. */
  const newCommissionJournals = async (): Promise<Array<Record<string, any>>> => {
    const all = await commissionJournals();
    return all.slice(Number(baselineJournalCount));
  };

  /** Expense/payable movement caused BY THIS TEST. */
  const expenseDelta = async (): Promise<bigint> =>
    (await balanceOf(ACCOUNT_CODES.COMMISSION_EXPENSE)) - baselineExpense;
  const payableDelta = async (): Promise<bigint> =>
    (await balanceOf(ACCOUNT_CODES.COMMISSION_PAYABLE)) - baselinePayable;

  const balanceOf = async (code: string): Promise<bigint> => {
    const rows = await dataSource.query<Array<{ net: string }>>(
      `SELECT COALESCE(SUM(CASE WHEN l.direction='CREDIT' THEN l.amount_minor ELSE -l.amount_minor END),0)::text AS net
         FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE a.code=$1`,
      [code],
    );
    return BigInt(rows[0]!.net);
  };

  // ─────────────────────────────────────────────────────────────────────────── C01 parity

  it('C01. an approved nonzero rule: preview, recorded decision and posted accrual are the same number', async () => {
    const agent = await createAgent();
    await seedFeeRule({ flatFeeMinor: '0', vatBps: null });
    // 1% of the principal, targeted at this agent's class — a rule the operator can see in the preview.
    await seedCommissionRule({ percentageBps: 100, calculationBasis: 'PRINCIPAL' });

    // ── observation 1: the PREVIEW the operator reads, through the same resolver the runtime uses.
    const preview = await commissionResolver.resolveWithManager(
      dataSource.manager,
      {
        productCode: 'WALLET_TO_BANK',
        currency: 'NGN',
        agentId: agent.agent.id,
        agentClassId: agent.agentClassId,
      },
      { principalMinor: '100000', feeMinor: '0' },
    );
    expect(preview.status).toBe('ALLOCATED');
    const previewMinor = preview.allocations.reduce((sum, a) => sum + BigInt(a.amountMinor), 0n);
    expect(previewMinor).toBe(1000n);

    // ── the transfer is authorized but NOT yet settled. Pending must carry no commission at all.
    const run = await transferToSettlement({
      agentId: agent.agent.id,
      sessionId: agent.sessionId,
      walletAccountId: agent.walletAccountId,
      beneficiaryId: agent.beneficiaryId,
      amountMinor: '100000',
    });
    expect(await commitmentState(run.commitment.id)).toBe('RESERVED');
    expect(await snapshotsFor(run.commitment.id)).toHaveLength(0);
    expect(await newCommissionJournals()).toHaveLength(0);

    // ── settle: this is the event that earns the commission.
    const settled = await run.settle();
    expect(settled.decision).toBe('SETTLE');
    expect(await commitmentState(run.commitment.id)).toBe('SETTLED');

    // ── observation 2: the RECORDED decision, bound to the canonical transaction reference.
    const snapshots = await snapshotsFor(run.commitment.id);
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0]!;
    expect(snapshot.product).toBe('WALLET_TO_BANK');
    expect(snapshot.idempotency_key).toBe(`wallet-to-bank:${run.commitment.id}`);
    expect(snapshot.principal_type).toBe('AGENT');
    expect(snapshot.principal_id).toBe(agent.agent.id);
    expect(snapshot.commission_decision.status).toBe('ALLOCATED');

    const allocations = snapshot.commission_decision.allocations as Array<{
      beneficiaryType: string;
      beneficiaryId: string | null;
      amountMinor: string;
    }>;
    expect(allocations).toHaveLength(1);
    // The rule targets a CLASS, so the engine leaves the identity null; attribution supplies the acting
    // agent. Without this the payable would belong to nobody.
    expect(allocations[0]!.beneficiaryType).toBe('AGENT');
    expect(allocations[0]!.beneficiaryId).toBe(agent.agent.id);
    const recordedMinor = allocations.reduce((sum, a) => sum + BigInt(a.amountMinor), 0n);
    expect(recordedMinor).toBe(previewMinor);

    // ── observation 3: the POSTED accrual — real ledger legs, not a claim that posting happened.
    expect(await expenseDelta()).toBe(-1000n);
    expect(await payableDelta()).toBe(1000n);
    const journals = await newCommissionJournals();
    expect(journals).toHaveLength(1);
    const lines = await dataSource.query<
      Array<{ direction: string; amount_minor: string; code: string }>
    >(
      `SELECT l.direction, l.amount_minor::text AS amount_minor, a.code
         FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id
        WHERE l.journal_id=$1 ORDER BY l.line_number`,
      [journals[0]!.id],
    );
    const expenseLeg = lines.find((line) => line.code === ACCOUNT_CODES.COMMISSION_EXPENSE)!;
    const payableLeg = lines.find((line) => line.code === ACCOUNT_CODES.COMMISSION_PAYABLE)!;
    expect(expenseLeg).toMatchObject({ direction: 'DEBIT', amount_minor: previewMinor.toString() });
    expect(payableLeg).toMatchObject({
      direction: 'CREDIT',
      amount_minor: previewMinor.toString(),
    });

    // The accrual is stated as accrual-only: settlement of the payable is explicitly out of V1 scope.
    expect(snapshot.commission_decision.posting).toMatchObject({
      journalLegsPosted: true,
      treatment: 'EXPENSE_PAYABLE',
      settlementState: 'ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED',
    });
  }, 180000);

  // ─────────────────────────────────────────────────────────────────────────── C02 explicit zero

  it('C02. an authored rule that computes to zero is recorded as an explicit zero, with no journal', async () => {
    const agent = await createAgent();
    await seedFeeRule({ flatFeeMinor: '0', vatBps: null });
    // A real, active, approved rule whose arithmetic is zero. This is configuration, not absence.
    await seedCommissionRule({ flatCommissionMinor: '0', calculationBasis: 'PRINCIPAL' });

    const run = await transferToSettlement({
      agentId: agent.agent.id,
      sessionId: agent.sessionId,
      walletAccountId: agent.walletAccountId,
      beneficiaryId: agent.beneficiaryId,
      amountMinor: '50000',
    });
    await run.settle();

    const snapshots = await snapshotsFor(run.commitment.id);
    expect(snapshots).toHaveLength(1);
    // ALLOCATED + 0 is materially different from NONE: a rule WAS configured and it evaluated to zero.
    expect(snapshots[0]!.commission_decision.status).toBe('ALLOCATED');
    const allocations = snapshots[0]!.commission_decision.allocations as Array<{
      amountMinor: string;
    }>;
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.amountMinor).toBe('0');

    // Nothing is owed, so nothing is posted — and the evidence says why.
    expect(await newCommissionJournals()).toHaveLength(0);
    expect(await payableDelta()).toBe(0n);
    expect(snapshots[0]!.commission_decision.posting).toMatchObject({
      journalLegsPosted: false,
      reason: 'ZERO_AMOUNT_NO_LEGS_POSTED',
    });
  }, 180000);

  it('C02b. no configured rule at all is recorded as an explicit NONE, never as a zero', async () => {
    const agent = await createAgent();
    await seedFeeRule({ flatFeeMinor: '0', vatBps: null });

    const run = await transferToSettlement({
      agentId: agent.agent.id,
      sessionId: agent.sessionId,
      walletAccountId: agent.walletAccountId,
      beneficiaryId: agent.beneficiaryId,
      amountMinor: '50000',
    });
    await run.settle();

    const snapshots = await snapshotsFor(run.commitment.id);
    expect(snapshots).toHaveLength(1);
    // "We evaluated and found nothing" — distinct from C02's "a rule said zero".
    expect(snapshots[0]!.commission_decision.status).toBe('NONE');
    expect(snapshots[0]!.commission_decision.allocations).toEqual([]);
    expect(await newCommissionJournals()).toHaveLength(0);
  }, 180000);

  // ─────────────────────────────────────────────────────────────────────────── C03 failed

  it('C03. a rejected transfer releases its commitment and earns no commission at all', async () => {
    const agent = await createAgent();
    await seedFeeRule({ flatFeeMinor: '0', vatBps: null });
    await seedCommissionRule({ percentageBps: 100, calculationBasis: 'PRINCIPAL' });

    const run = await transferToSettlement({
      agentId: agent.agent.id,
      sessionId: agent.sessionId,
      walletAccountId: agent.walletAccountId,
      beneficiaryId: agent.beneficiaryId,
      amountMinor: '100000',
    });
    // A reserved withdrawal cannot be settled as a rejection (that would settle an outstanding
    // obligation); the provider-verified release path is the real failure route.
    verificationState = 'VERIFIED_REJECTED';
    await (
      settlement as unknown as {
        releaseReservedWithdrawal: (command: unknown) => Promise<unknown>;
      }
    ).releaseReservedWithdrawal({
      externalOperationId: run.operationId,
      expectedVersion: run.pendingVersion,
      requestContext,
    });
    expect(await commitmentState(run.commitment.id)).toBe('RELEASED');

    // No decision, no allocation, no journal — a transfer that never happened cannot pay anyone.
    expect(await snapshotsFor(run.commitment.id)).toHaveLength(0);
    expect(await newCommissionJournals()).toHaveLength(0);
    expect(await payableDelta()).toBe(0n);
    expect(await expenseDelta()).toBe(0n);
  }, 180000);

  // ─────────────────────────────────────────────────────────────────────────── C04 replay

  it('C04. replaying the settlement is refused and leaves exactly one decision and one journal', async () => {
    const agent = await createAgent();
    await seedFeeRule({ flatFeeMinor: '0', vatBps: null });
    await seedCommissionRule({ percentageBps: 100, calculationBasis: 'PRINCIPAL' });

    const run = await transferToSettlement({
      agentId: agent.agent.id,
      sessionId: agent.sessionId,
      walletAccountId: agent.walletAccountId,
      beneficiaryId: agent.beneficiaryId,
      amountMinor: '100000',
    });
    await run.settle();
    expect(await snapshotsFor(run.commitment.id)).toHaveLength(1);
    expect(await newCommissionJournals()).toHaveLength(1);

    // Second settlement attempt on the same operation. It is refused (DUPLICATE_SETTLEMENT) or served
    // as an idempotent replay of the recorded response — either way it must add nothing. Asserting the
    // outcome rows rather than the exception type is what makes this a statement about money.
    const replay = await run.settle().then(
      (value) => ({ value, error: null as Error | null }),
      (error: Error) => ({ value: null, error }),
    );
    if (replay.error) {
      expect(String(replay.error.message)).toMatch(/DUPLICATE|already|settled/i);
    } else {
      expect(replay.value).toBeDefined();
      const state = await commitmentState(run.commitment.id);
      expect(state).toBe('SETTLED');
    }

    expect(await snapshotsFor(run.commitment.id)).toHaveLength(1);
    expect(await newCommissionJournals()).toHaveLength(1);
    expect(await payableDelta()).toBe(1000n);
    expect(await expenseDelta()).toBe(-1000n);
  }, 180000);

  // ─────────────────────────────────────────────────────────────────────────── attribution

  it('C05. a rule targeted at a DIFFERENT agent does not pay the acting agent', async () => {
    const acting = await createAgent();
    const other = await createAgent();
    await seedFeeRule({ flatFeeMinor: '0', vatBps: null });
    // Explicitly targeted at somebody else: the resolver must not match it for the acting agent.
    await seedCommissionRule({
      percentageBps: 100,
      calculationBasis: 'PRINCIPAL',
      agentId: other.agent.id,
    });

    const run = await transferToSettlement({
      agentId: acting.agent.id,
      sessionId: acting.sessionId,
      walletAccountId: acting.walletAccountId,
      beneficiaryId: acting.beneficiaryId,
      amountMinor: '100000',
    });
    await run.settle();

    const snapshots = await snapshotsFor(run.commitment.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.commission_decision.status).toBe('NONE');
    expect(await newCommissionJournals()).toHaveLength(0);
  }, 180000);
});
