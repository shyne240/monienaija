import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AuthenticationExecutionService } from '../src/customer-authentication/authentication-execution.service';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import { PasswordHashVerificationService } from '../src/customer-authentication/password-hash-verification.service';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { CustomerBeneficiaryService } from '../src/customer-beneficiary/customer-beneficiary.service';
import {
  CustomerBeneficiaryStatus,
  CustomerBeneficiaryType,
} from '../src/customer-beneficiary/customer-beneficiary.enums';
import { FinancialCommitmentService } from '../src/financial-commitment/financial-commitment.service';
import { FinancialCommitmentRepository } from '../src/financial-commitment/financial-commitment.repository';
import {
  KycTierEvidenceReader,
  type TierEvidenceSnapshot,
} from '../src/kyc-verification/kyc-tier-evidence.reader';
import { KycTierWorker } from '../src/kyc-verification/kyc-tier-worker.service';
import { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import { LimitUsageService } from '../src/limit-catalog/limit-usage.service';
import { WalletFinancialBoundaryService } from '../src/wallet/wallet-financial-boundary.service';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';
import { ExternalOperationLifecycleService } from '../src/partner/external-operation-lifecycle.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { DataSource } from 'typeorm';

import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { OutboxService } from '../src/operations/outbox.service';
import { SettlementAccountService } from '../src/payment/settlement-account.service';
import { ExternalOperationLifecycleState } from '../src/partner/external-operation-lifecycle.enums';
import { ExternalOperationReferenceSource } from '../src/partner/external-operation.enums';
import { ExternalOperationService } from '../src/partner/external-operation.service';
import { ExternalSettlement } from '../src/partner/external-settlement.entity';
import {
  ExternalSettlementDecision,
  ExternalSettlementStatus,
  ExternalSuspenseStatus,
} from '../src/partner/external-settlement.enums';
import { ExternalSettlementService } from '../src/partner/external-settlement.service';
import { ExternalSuspenseEntry } from '../src/partner/external-suspense-entry.entity';
import { EnvironmentPartnerCredentialLoader } from '../src/partner/partner-credentials.service';
import { PartnerCapabilityRegistry } from '../src/partner/partner-capability.registry';
import { PartnerConnectionService } from '../src/partner/partner-connection.service';
import { PartnerRequestSigningService } from '../src/partner/partner-request-signing.service';
import type {
  RecordCompensatingEntryCommand,
  SettleVerifiedOutcomeCommand,
  SuspenseVerifiedOutcomeCommand,
} from '../src/partner/external-settlement.types';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  seedTransferParticipant,
  truncateAllTables,
} from './support/pg-harness';

/**
 * A6T08 settlement lifecycle coverage against real PostgreSQL.
 *
 * Uses the real ExternalSettlementService, the real LedgerService and real persistence. No
 * external partner transport is involved: the partner boundary stays disabled and every
 * outcome is supplied as already-verified evidence, exactly as the A6 contract requires.
 *
 * This is the suite that proves the corrected `chk_external_settlements_posted_journal`
 * constraint, which previously made the compensation path structurally impossible.
 */
describe('A6T08 settlement lifecycle (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: ExternalSettlementService;
  let ledger: LedgerService;
  let app: NestFastifyApplication;
  let commitmentService: FinancialCommitmentService;
  const snapshots = new Map<string, TierEvidenceSnapshot>();

  const requestContext = {
    requestId: 'req-a6-settlement',
    correlationId: 'corr-a6-settlement',
    traceId: 'trace-a6-settlement',
  };

  const partnerEnv: Record<string, string> = {
    NODE_ENV: 'development',
    A6_PARTNER_ENABLED: 'false',
    A6_PARTNER_ENVIRONMENT: 'sandbox',
    A6_PARTNER_KEY: 'NIBSS_NIP',
    A6_PARTNER_CAPABILITY: 'external.wallet.withdrawal.settlement',
    A6_PARTNER_OPERATION_TYPE: 'OUTBOUND_BANK_SETTLEMENT',
    A6_PARTNER_API_VERSION: 'v1',
    A6_PARTNER_ADAPTER_VERSION: 'a6-adapter-1',
    A6_PARTNER_SIGNING_ALGORITHM: 'HMAC_SHA256',
    A6_PARTNER_CALLBACK_MAX_SKEW_SECONDS: '300',
    A6_PARTNER_CIRCUIT_FAILURE_THRESHOLD: '3',
    A6_PARTNER_CIRCUIT_OPEN_SECONDS: '60',
    A6_PARTNER_REQUEST_TIMEOUT_MS: '10000',
    A6_PARTNER_CONNECT_TIMEOUT_MS: '3000',
    // Reference-only configuration. The host is deliberately in the reserved `.invalid` TLD
    // and the credential/signing entries are opaque local references, not real secrets. The
    // partner boundary stays disabled and this suite performs no outbound request.
    A6_PARTNER_SANDBOX_BASE_URL: 'https://a6-sandbox.invalid/settlement',
    A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE: 'local-integration-credential-reference',
    A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE: 'local-integration-signing-key-reference',
  };

  const configService = {
    get: (key: string): string | undefined => partnerEnv[key],
  } as unknown as ConfigService;

  let verificationOverride:
    | 'VERIFIED_SETTLED'
    | 'VERIFIED_REJECTED'
    | 'UNKNOWN'
    | 'UNAVAILABLE'
    | null = null;
  let verificationHashOverride: string | null = null;
  let customerLedgerAccountId: string;
  let settlementAssetLedgerAccountId: string;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a6settlement');

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue({
        read: (_manager: unknown, id: string) => Promise.resolve(snapshots.get(id) ?? null),
      })
      // The periodic background worker must not race the suite's per-test TRUNCATE.
      // Financial eligibility is still evaluated by the real synchronous boundary.
      .overrideProvider(KycTierWorker)
      .useValue({})
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(new TestNotificationProvider())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    ledger = app.get(LedgerService);
    const audit = app.get(AuditService);
    const idempotency = app.get(IdempotencyService);
    const outbox = app.get(OutboxService);
    const operations = app.get(ExternalOperationService);
    commitmentService = new FinancialCommitmentService(
      dataSource,
      app.get(AuthenticationSessionService),
      app.get(CustomerTransactionPinService),
      app.get(PasswordHashVerificationService),
      app.get(WalletFinancialBoundaryService),
      app.get(LimitEnforcementService),
      app.get(WithdrawalService),
      operations,
      ledger,
      new FinancialCommitmentRepository(),
      { authorize: () => Promise.resolve('AUTHORIZED') },
    );
    const connection = new PartnerConnectionService(
      configService,
      new PartnerCapabilityRegistry(),
      new EnvironmentPartnerCredentialLoader(configService),
      new PartnerRequestSigningService(),
    );

    service = new ExternalSettlementService(
      dataSource.getRepository(ExternalSettlement),
      dataSource.getRepository(ExternalSuspenseEntry),
      dataSource,
      ledger,
      new SettlementAccountService(),
      operations,
      idempotency,
      audit,
      connection,
      outbox,
      {
        verify: async ({ operation }) => {
          // The controlled adapter changes its answer only after a settlement commits,
          // simulating a later independently verified rejection for recovery tests.
          const prior = await dataSource.getRepository(ExternalSettlement).findOne({
            where: { externalOperationId: operation.externalOperationId },
          });
          const reference = operation.providerReferences.find(
            (r) =>
              r.source === ExternalOperationReferenceSource.STATUS_QUERY &&
              r.referenceValue.startsWith(prior ? 'confirmed-' : 'provider-evidence-'),
          );
          return {
            state: verificationOverride ?? (prior ? 'VERIFIED_REJECTED' : 'VERIFIED_SETTLED'),
            providerStatus: prior ? 'REJECTED' : 'SETTLED',
            providerReferenceHash:
              verificationHashOverride ?? (reference ? sha256(reference.referenceValue) : null),
            observedAt: new Date().toISOString(),
            reasonCode: null,
          };
        },
      },
      app.get(LimitUsageService),
    );
  }, 180000);

  afterAll(async () => {
    if (app) await app.close();
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    verificationOverride = null;
    verificationHashOverride = null;
    await truncateAllTables(dataSource);
    snapshots.clear();
    const proposal = randomUUID();
    const requirements = { all: [], any: [] };
    const definition = {
      regulatoryRequirementsConfirmed: true,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveUntil: null,
      regulatory: { LEVEL_1: requirements, LEVEL_2: requirements },
      operator: { LEVEL_1: requirements, LEVEL_2: requirements },
    };
    await dataSource.query(
      `INSERT INTO kyc_tier_policy_proposals(id,request_id,expected_version,definition,fingerprint,maker_id,maker_session_id,checker_id,checker_session_id,state)
      VALUES($1,$2,0,$3,$4,'maker',$5,'checker',$6,'APPROVED')`,
      [
        proposal,
        randomUUID(),
        JSON.stringify(definition),
        'a'.repeat(64),
        randomUUID(),
        randomUUID(),
      ],
    );
    await dataSource.query(
      `INSERT INTO kyc_tier_policy_versions(version,proposal_id,definition,maker_id,checker_id) VALUES(1,$1,$2,'maker','checker')`,
      [proposal, JSON.stringify(definition)],
    );
    await dataSource.query('INSERT INTO kyc_tier_policy_head(singleton,version) VALUES(true,1)');
    await dataSource.query(
      `INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status) VALUES($1,'FCBANK','Test Bank','Test',true,'ACTIVE')`,
      [randomUUID()],
    );
    await ledger.createAccount({
      code: 'PAYMENT-WITHDRAWAL_RESERVE-NGN',
      name: 'Withdrawal reserve',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
    const suffix = randomUUID().slice(0, 8);
    const customer = await ledger.createAccount({
      code: `A6-CUST-${suffix}`,
      name: 'Customer funds',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
    // Canonical settlement accounts, discovered by SettlementAccountService by code.
    const asset = await ledger.createAccount({
      code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
      name: 'Settlement asset',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    await ledger.createAccount({
      code: 'PAYMENT-SETTLEMENT_CLEARING-NGN',
      name: 'Settlement clearing',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    await ledger.createAccount({
      code: 'PAYMENT-SYSTEM_SUSPENSE-NGN',
      name: 'System suspense',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    customerLedgerAccountId = customer.id;
    settlementAssetLedgerAccountId = asset.id;

    // Fund the customer liability account so a settlement debit has balance to consume.
    await ledger.postJournal({
      idempotencyKey: `a6-fund-${suffix}`,
      reference: `a6-fund-${suffix}`,
      description: 'Seed customer funds',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        {
          accountId: settlementAssetLedgerAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: '100000',
        },
        {
          accountId: customerLedgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '100000',
        },
      ],
    });
  }, 60000);

  async function seedOperation(
    lifecycleState: ExternalOperationLifecycleState = ExternalOperationLifecycleState.PENDING_VERIFICATION,
    accountId = customerLedgerAccountId,
  ): Promise<{ id: string; version: number; evidenceValue: string }> {
    const suffix = randomUUID().slice(0, 8);
    if (accountId !== customerLedgerAccountId)
      await ledger.postJournal({
        idempotencyKey: `a6-other-fund-${suffix}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: settlementAssetLedgerAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '1000',
          },
          { accountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
        ],
      });
    const participant = await seedTransferParticipant(dataSource, `a6${suffix}`, accountId);
    await dataSource.query(
      `INSERT INTO customer_contact_methods(customer_id,type,value,normalized_value,is_primary,verified_at)
      VALUES($1,'PHONE',$2,$2,true,clock_timestamp())`,
      [participant.customerId, `phone-${randomUUID()}`],
    );
    await dataSource.query(
      `INSERT INTO customer_kyc_assessments(customer_id,kyc_level,kyc_status,assessed_by,expires_at)
      VALUES($1,'LEVEL_1','APPROVED','fixture',clock_timestamp()+interval '1 hour')`,
      [participant.customerId],
    );
    snapshots.set(participant.customerId, {
      identityRevision: 'fixture',
      evidence: [
        {
          id: randomUUID(),
          customerId: participant.customerId,
          identityRevision: 'fixture',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verifiedAt: new Date(Date.now() - 10000),
          expiresAt: new Date(Date.now() + 1800000),
        },
      ],
    });
    function hashPassword(value: string): string {
      const salt = randomBytes(16);
      const derived = pbkdf2Sync(value, salt, 10000, 32, 'sha256');
      return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
    }
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials(id,customer_id,password_hash,hash_algorithm,password_version,status,mobile_otp_required)
      VALUES($1,$2,$3,'PBKDF2',1,'ACTIVE',false)`,
      [randomUUID(), participant.customerId, hashPassword('password-123')],
    );
    await app.get(CustomerTransactionPinService).setTransactionPin(participant.customerId, {
      pinHash: hashPassword('1234'),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: participant.customerId,
    });
    const authentication = await app.get(AuthenticationExecutionService).authenticate({
      customerId: participant.customerId,
      password: 'password-123',
      actor: participant.customerId,
    });
    if (!authentication.authenticated) throw new Error('Fixture authentication failed');
    const session = await app
      .get(AuthenticationSessionService)
      .issue({ authentication, actor: participant.customerId });
    const beneficiaries = app.get(CustomerBeneficiaryService);
    const beneficiary = await beneficiaries.createBeneficiary(participant.customerId, {
      type: CustomerBeneficiaryType.BANK_ACCOUNT,
      displayName: 'Test beneficiary',
      reference: `a6-${randomUUID()}`,
      destinationIdentifier: '1234567890',
      destinationInstitution: 'FCBANK',
      actor: participant.customerId,
    });
    await beneficiaries.verifyBeneficiary(participant.customerId, beneficiary.id, {
      verifiedBy: 'test',
      verificationMethod: 'controlled-test',
    });
    await beneficiaries.updateBeneficiary(participant.customerId, beneficiary.id, {
      status: CustomerBeneficiaryStatus.ACTIVE,
      actor: participant.customerId,
    });
    const initiated = await commitmentService.initiate({
      token: session.accessToken,
      pin: '1234',
      walletAccountId: participant.walletAccountId,
      beneficiaryId: beneficiary.id,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `a6-${randomUUID()}`,
    });
    const id = initiated.commitment.external_operation_id;
    const lifecycle = app.get(ExternalOperationLifecycleService);
    let version: number;
    if (lifecycleState === ExternalOperationLifecycleState.CANCELLED) {
      version = (
        await lifecycle.transition({
          externalOperationId: id,
          expectedVersion: 1,
          nextState: lifecycleState,
          idempotencyKey: `cancel-${randomUUID()}`,
          requestContext,
        })
      ).version;
    } else {
      const attempt = await lifecycle.beginAttempt(
        id,
        `attempt-${randomUUID()}`,
        requestContext,
        1,
      );
      version = (
        await lifecycle.transition({
          externalOperationId: id,
          expectedVersion: attempt.version,
          nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
          idempotencyKey: `pending-${randomUUID()}`,
          requestContext,
        })
      ).version;
    }
    const evidenceValue = `provider-evidence-${suffix}`;
    await app.get(ExternalOperationService).recordProviderReference({
      externalOperationId: id,
      partnerKey: 'NIBSS_NIP',
      referenceType: 'TRANSACTION' as never,
      referenceValue: evidenceValue,
      namespace: 'nibss.nip',
      source: ExternalOperationReferenceSource.STATUS_QUERY,
      requestContext,
    });
    await app.get(ExternalOperationService).recordProviderReference({
      externalOperationId: id,
      partnerKey: 'NIBSS_NIP',
      referenceType: 'TRANSACTION' as never,
      referenceValue: `confirmed-${suffix}`,
      namespace: 'nibss.nip',
      source: ExternalOperationReferenceSource.STATUS_QUERY,
      requestContext,
    });
    return { id, version, evidenceValue };
  }

  /** Explicit pre-commitment historical fixture. No new authorization is inferred or backfilled:
   * the posted journal and settlement represent persisted records from the old lifecycle. */
  async function historicalSettlement() {
    const suffix = randomUUID().slice(0, 8);
    const participant = await seedTransferParticipant(
      dataSource,
      `historical${suffix}`,
      customerLedgerAccountId,
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods(customer_id,type,value,normalized_value,is_primary,verified_at)
      VALUES($1,'PHONE',$2,$2,true,clock_timestamp())`,
      [participant.customerId, `phone-${randomUUID()}`],
    );
    await dataSource.query(
      `INSERT INTO customer_kyc_assessments(customer_id,kyc_level,kyc_status,assessed_by,expires_at)
      VALUES($1,'LEVEL_1','APPROVED','fixture',clock_timestamp()+interval '1 hour')`,
      [participant.customerId],
    );
    snapshots.set(participant.customerId, {
      identityRevision: 'fixture',
      evidence: [
        {
          id: randomUUID(),
          customerId: participant.customerId,
          identityRevision: 'fixture',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verifiedAt: new Date(Date.now() - 10000),
          expiresAt: new Date(Date.now() + 1800000),
        },
      ],
    });
    const withdrawalId = randomUUID();
    await dataSource.query(
      `INSERT INTO withdrawals (id,wallet_id,payment_reference,amount_minor,currency,status,idempotency_key,request_hash)
      VALUES ($1,$2,$3,1000,'NGN','PENDING',$4,$5)`,
      [
        withdrawalId,
        participant.walletAccountId,
        `wd-${suffix}`,
        `wd-key-${suffix}`,
        sha256(`wd-${suffix}`),
      ],
    );
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO external_operations
      (id,operation_version,partner_key,capability_key,operation_type,resource_type,resource_id,internal_command_id,customer_id,wallet_account_id,ledger_account_id,
       target_mapping_reference,amount_minor,currency,accounting_unit,internal_idempotency_scope,internal_idempotency_key,provider_idempotency_scope,
       provider_idempotency_key,request_hash,request_id,correlation_id,trace_id,lifecycle_state,attempt_count,max_attempts,version)
      VALUES($1,1,'NIBSS_NIP','external.wallet.withdrawal.settlement','OUTBOUND_BANK_SETTLEMENT','WITHDRAWAL',$2,$3,$4,$5,$6,$7,1000,'NGN','CUSTOMER_FUNDS',
       'external.partner.operation.v1',$8,'nibss.nip.external-operation.v1',$9,$10,'request-1','correlation-1','trace-1','PENDING_VERIFICATION',1,3,1)`,
      [
        id,
        withdrawalId,
        randomUUID(),
        participant.customerId,
        participant.walletAccountId,
        customerLedgerAccountId,
        `a6-target:${sha256(suffix)}`,
        `operation-key-${suffix}`,
        `provider-key-${suffix}`,
        sha256(`request-${suffix}`),
      ],
    );
    const evidenceValue = `provider-evidence-${suffix}`;
    for (const value of [evidenceValue, `confirmed-${suffix}`])
      await dataSource.query(
        `INSERT INTO external_operation_references
      (id,external_operation_id,partner_key,reference_type,reference_value,namespace,source,observed_at)
      VALUES($1,$2,'NIBSS_NIP','TRANSACTION',$3,'nibss.nip','STATUS_QUERY',now())`,
        [randomUUID(), id, value],
      );
    const journal = await ledger.postJournal({
      idempotencyKey: `historical-${suffix}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        {
          accountId: customerLedgerAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: '1000',
        },
        {
          accountId: settlementAssetLedgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '1000',
        },
      ],
    });
    const settlementId = randomUUID();
    await dataSource.query(
      `INSERT INTO external_settlements
      (id,external_operation_id,external_operation_reference,partner_key,capability_key,operation_type,customer_id,wallet_account_id,customer_ledger_account_id,
       settlement_asset_ledger_account_id,decision,status,amount_minor,currency,accounting_unit,lifecycle_state,journal_id,evidence_type,evidence_value,
       evidence_namespace,evidence_source,evidence_hash,idempotency_scope,idempotency_key,request_hash,correlation_id,request_id,owner_principal,posted_at)
      VALUES($1,$2,$3,'NIBSS_NIP','external.wallet.withdrawal.settlement','OUTBOUND_BANK_SETTLEMENT',$4,$5,$6,$7,'SETTLE','POSTED',1000,'NGN','CUSTOMER_FUNDS',
       'SETTLED',$8,'TRANSACTION',$9,'nibss.nip','STATUS_QUERY',$10,'historical',$11,$12,'historical','historical','historical',now())`,
      [
        settlementId,
        id,
        `a6-external-operation:${id}`,
        participant.customerId,
        participant.walletAccountId,
        customerLedgerAccountId,
        settlementAssetLedgerAccountId,
        journal.id,
        evidenceValue,
        sha256(evidenceValue),
        `a6-settlement:${sha256(suffix)}`,
        sha256(`historical-${suffix}`),
      ],
    );
    return {
      operation: { id, version: 1, evidenceValue },
      settled: { settlement: { settlementId, journalId: journal.id, settlementVersion: 1 } },
    };
  }

  function settleCommand(
    operation: { id: string; version: number; evidenceValue: string },
    overrides: Partial<SettleVerifiedOutcomeCommand> = {},
  ): SettleVerifiedOutcomeCommand {
    return {
      externalOperationId: operation.id,
      decision: ExternalSettlementDecision.SETTLE,
      expectedVersion: operation.version,
      evidence: {
        referenceType: 'TRANSACTION',
        referenceValue: operation.evidenceValue,
        namespace: 'nibss.nip',
        source: ExternalOperationReferenceSource.STATUS_QUERY,
        observedAt: new Date(),
      },
      requestContext,
      ...overrides,
    };
  }

  function suspenseCommand(
    operation: { id: string; version: number; evidenceValue: string },
    overrides: Partial<SuspenseVerifiedOutcomeCommand> = {},
  ): SuspenseVerifiedOutcomeCommand {
    return {
      externalOperationId: operation.id,
      reason: 'SETTLEMENT_AMOUNT_MISMATCH',
      rejectionCode: 'SETTLEMENT_AMOUNT_MISMATCH',
      expectedVersion: operation.version,
      evidence: {
        referenceType: 'TRANSACTION',
        referenceValue: operation.evidenceValue,
        namespace: 'nibss.nip',
        source: ExternalOperationReferenceSource.STATUS_QUERY,
        observedAt: new Date(),
      },
      requestContext,
      ...overrides,
    };
  }

  function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  it('settles a verified outcome and posts a balanced journal', async () => {
    const operation = await seedOperation();
    const result = await service.settleVerifiedOutcome(settleCommand(operation));

    expect(result.replayed).toBe(false);
    expect(result.settlement.decision).toBe(ExternalSettlementDecision.SETTLE);
    expect(result.settlement.status).toBe(ExternalSettlementStatus.POSTED);
    expect(result.settlement.journalId).toBeTruthy();
    expect(result.settlement.reversalJournalId).toBeNull();

    const lines: Array<{ direction: string; amount_minor: string; ledger_account_id: string }> =
      await dataSource.query(
        'SELECT direction, amount_minor, ledger_account_id FROM ledger_lines WHERE journal_id = $1',
        [result.settlement.journalId],
      );
    expect(lines).toHaveLength(2);
    const debits = lines.filter((l) => l.direction === String(LedgerEntryDirection.DEBIT));
    const credits = lines.filter((l) => l.direction === String(LedgerEntryDirection.CREDIT));
    expect(BigInt(debits[0]!.amount_minor)).toBe(BigInt(credits[0]!.amount_minor));
    const reserve = (
      await dataSource.query<Array<{ id: string }>>(
        `SELECT id FROM ledger_accounts WHERE code='PAYMENT-WITHDRAWAL_RESERVE-NGN'`,
      )
    )[0]!.id;
    expect(debits[0]).toMatchObject({ ledger_account_id: reserve, amount_minor: '1000' });
    expect(credits[0]).toMatchObject({
      ledger_account_id: settlementAssetLedgerAccountId,
      amount_minor: '1000',
    });
    expect((await ledger.getAccountBalance(customerLedgerAccountId)).balanceMinor).toBe('99000');
    expect((await ledger.getAccountBalance(reserve)).balanceMinor).toBe('0');
    expect(
      await dataSource.query(
        `SELECT state FROM financial_commitments WHERE external_operation_id=$1`,
        [operation.id],
      ),
    ).toEqual([{ state: 'SETTLED' }]);
  });

  it('replays an identical settlement without posting a second journal', async () => {
    const operation = await seedOperation();
    const command = settleCommand(operation);
    const first = await service.settleVerifiedOutcome(command);
    const second = await service.settleVerifiedOutcome(command);

    expect(second.replayed).toBe(true);
    expect(second.settlement.journalId).toBe(first.settlement.journalId);
    const journals: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_journals',
    );
    expect(journals).toHaveLength(3); // funding, authorized reservation and settlement
  });

  it('concurrent committed outbound settlement creates exactly one journal and replays it', async () => {
    const op = await seedOperation();
    const command = settleCommand(op);
    const outcomes = await Promise.allSettled([
      service.settleVerifiedOutcome(command),
      service.settleVerifiedOutcome(command),
    ]);
    expect(outcomes.some((x) => x.status === 'fulfilled')).toBe(true);
    const replay = await service.settleVerifiedOutcome(command);
    expect(replay.replayed).toBe(true);
    expect(
      await dataSource.query(
        'SELECT count(*)::int n FROM external_settlements WHERE external_operation_id=$1',
        [op.id],
      ),
    ).toEqual([{ n: 1 }]);
    expect(
      await dataSource.query('SELECT count(*)::int n FROM ledger_journals WHERE id=$1', [
        replay.settlement.journalId,
      ]),
    ).toEqual([{ n: 1 }]);
    expect((await ledger.getAccountBalance(customerLedgerAccountId)).balanceMinor).toBe('99000');
  });
  it('rejects unverified or mismatched provider success for a committed withdrawal and allows a verified retry', async () => {
    const op = await seedOperation();
    const command = settleCommand(op);
    for (const state of ['UNKNOWN', 'UNAVAILABLE', 'VERIFIED_REJECTED'] as const) {
      verificationOverride = state;
      await expect(service.settleVerifiedOutcome(command)).rejects.toThrow();
      expect(await service.getByOperation(op.id)).toBeNull();
      expect((await ledger.getAccountBalance(customerLedgerAccountId)).balanceMinor).toBe('99000');
    }
    verificationOverride = 'VERIFIED_SETTLED';
    verificationHashOverride = sha256('fabricated-provider-reference');
    await expect(service.settleVerifiedOutcome(command)).rejects.toThrow();
    expect(await service.getByOperation(op.id)).toBeNull();
    verificationHashOverride = null;
    const posted = await service.settleVerifiedOutcome(command);
    expect(posted.settlement.status).toBe('POSTED');
    expect((await service.settleVerifiedOutcome(command)).replayed).toBe(true);
    expect((await ledger.getAccountBalance(customerLedgerAccountId)).balanceMinor).toBe('99000');
  });
  it('rejects the same settlement key carrying different evidence', async () => {
    const operation = await seedOperation();
    await service.settleVerifiedOutcome(settleCommand(operation));
    await expect(
      service.settleVerifiedOutcome(
        settleCommand(operation, {
          evidence: {
            referenceType: 'TRANSACTION',
            referenceValue: 'conflicting-evidence',
            namespace: 'nibss.nip',
            source: ExternalOperationReferenceSource.STATUS_QUERY,
            observedAt: new Date(),
          },
        }),
      ),
    ).rejects.toBeTruthy();
  });

  it('refuses to settle an operation that is not in a verifiable lifecycle state', async () => {
    const operation = await seedOperation(ExternalOperationLifecycleState.CANCELLED);
    await expect(service.settleVerifiedOutcome(settleCommand(operation))).rejects.toBeTruthy();
    const settlements: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM external_settlements',
    );
    expect(settlements).toHaveLength(0);
  });

  it('uses the persisted operation version for committed outbound settlement', async () => {
    const operation = await seedOperation();
    expect(operation.version).toBeGreaterThan(1);
    const result = await service.settleVerifiedOutcome(settleCommand(operation));
    expect(result.settlement.status).toBe(ExternalSettlementStatus.POSTED);
  });

  it('refuses to settle against a stale expected version', async () => {
    const operation = await seedOperation();
    await expect(
      service.settleVerifiedOutcome(settleCommand(operation, { expectedVersion: 99 })),
    ).rejects.toBeTruthy();
  });

  it('rejects evidence belonging to another operation without creating settlement or poisoning retry', async () => {
    const original = await seedOperation();
    const otherAccount = await ledger.createAccount({
      code: `A6-OTHER-${randomUUID()}`,
      name: 'Other customer',
      accountType: LedgerAccountType.LIABILITY,
      currency: 'NGN',
    });
    const other = await seedOperation(
      ExternalOperationLifecycleState.PENDING_VERIFICATION,
      otherAccount.id,
    );
    const wrong = settleCommand(original, {
      evidence: { ...settleCommand(other).evidence, observedAt: new Date() },
    });
    await expect(service.settleVerifiedOutcome(wrong)).rejects.toMatchObject({
      code: 'INTERNAL_ACCOUNT_MISMATCH',
    });
    const rows = await dataSource.query<Array<{ n: number }>>(
      'SELECT count(*)::int AS n FROM external_settlements WHERE external_operation_id=$1',
      [original.id],
    );
    expect(rows[0]!.n).toBe(0);
    const result = await service.settleVerifiedOutcome(settleCommand(original));
    expect(result.settlement.journalId).toBeTruthy();
  });

  it('rejects evidence with a forged source', async () => {
    const operation = await seedOperation();
    const command = settleCommand(operation);
    await expect(
      service.settleVerifiedOutcome({
        ...command,
        evidence: { ...command.evidence, source: ExternalOperationReferenceSource.ACKNOWLEDGEMENT },
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ACCOUNT_MISMATCH' });
  });

  it('records a suspense entry for an unreconciled outcome', async () => {
    const operation = await seedOperation();
    const suspense = await service.recordSuspense(suspenseCommand(operation));
    expect(suspense.suspenseId).toBeTruthy();
    expect(suspense.status).toBe(ExternalSuspenseStatus.OPEN);

    const rows: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM external_suspense_entries',
    );
    expect(rows).toHaveLength(1);
  });

  it('does not restore a settled commitment using rejection alone', async () => {
    const operation = await seedOperation();
    const settled = await service.settleVerifiedOutcome(settleCommand(operation));
    const suspense = await service.recordSuspense(suspenseCommand(operation));
    const before = await ledger.getAccountBalance(customerLedgerAccountId);
    const journals = await dataSource.query<Array<{ id: string }>>(
      'SELECT id FROM ledger_journals',
    );
    const command: RecordCompensatingEntryCommand = {
      externalOperationId: operation.id,
      settlementId: settled.settlement.settlementId,
      suspenseEntryId: suspense.suspenseId,
      expectedVersion: operation.version,
      requestContext,
    };
    await expect(service.recordCompensatingEntry(command)).rejects.toMatchObject({
      code: 'COMPENSATING_NOT_PERMITTED',
    });
    expect((await ledger.getAccountBalance(customerLedgerAccountId)).balanceMinor).toBe(
      before.balanceMinor,
    );
    expect(await dataSource.query('SELECT id FROM ledger_journals')).toHaveLength(journals.length);
    expect(
      await dataSource.query(
        'SELECT state FROM financial_commitments WHERE external_operation_id=$1',
        [operation.id],
      ),
    ).toEqual([{ state: 'SETTLED' }]);
  });

  it('posts a compensating entry and marks the settlement REVERSED', async () => {
    const { operation, settled } = await historicalSettlement();
    const suspense = await service.recordSuspense(suspenseCommand(operation));

    const command: RecordCompensatingEntryCommand = {
      externalOperationId: operation.id,
      settlementId: settled.settlement.settlementId,
      suspenseEntryId: suspense.suspenseId,
      expectedVersion: settled.settlement.settlementVersion,
      requestContext,
      reason: 'Provider reversed the outcome',
    };
    const compensated = await service.recordCompensatingEntry(command);

    expect(compensated.settlement.status).toBe(ExternalSettlementStatus.REVERSED);
    expect(compensated.settlement.reversalJournalId).toBeTruthy();
    expect(compensated.settlement.reversalJournalId).not.toBe(settled.settlement.journalId);
  });

  it('keeps the compensating pair net-zero on the customer account', async () => {
    const { operation, settled } = await historicalSettlement();
    const suspense = await service.recordSuspense(suspenseCommand(operation));
    await service.recordCompensatingEntry({
      externalOperationId: operation.id,
      settlementId: settled.settlement.settlementId,
      suspenseEntryId: suspense.suspenseId,
      expectedVersion: settled.settlement.settlementVersion,
      requestContext,
    });

    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance
         FROM ledger_lines WHERE ledger_account_id = $1`,
      [customerLedgerAccountId],
    );
    // Net of the seeding credit, the settle/compensate pair cancels out exactly.
    expect(BigInt(firstRow(rows, 'net customer balance').balance)).toBe(100000n);
  });

  it('rejects compensation when the suspense belongs to another operation', async () => {
    const { operation, settled } = await historicalSettlement();
    const suspense = await service.recordSuspense(suspenseCommand(operation));
    await dataSource.query(
      'UPDATE external_suspense_entries SET external_operation_id=$1 WHERE id=$2',
      [randomUUID(), suspense.suspenseId],
    );
    const before = await ledger.getAccountBalance(customerLedgerAccountId);
    await expect(
      service.recordCompensatingEntry({
        externalOperationId: operation.id,
        settlementId: settled.settlement.settlementId,
        suspenseEntryId: suspense.suspenseId,
        expectedVersion: settled.settlement.settlementVersion,
        requestContext,
      }),
    ).rejects.toMatchObject({ code: 'COMPENSATING_NOT_PERMITTED' });
    expect((await ledger.getAccountBalance(customerLedgerAccountId)).balanceMinor).toBe(
      before.balanceMinor,
    );
    const rows: Array<{ reversal_journal_id: string | null }> = await dataSource.query(
      'SELECT reversal_journal_id FROM external_settlements WHERE id=$1',
      [settled.settlement.settlementId],
    );
    expect(rows[0]!.reversal_journal_id).toBeNull();
  });

  it('prevents a duplicate compensation for the same settlement', async () => {
    const { operation, settled } = await historicalSettlement();
    const suspense = await service.recordSuspense(suspenseCommand(operation));
    const command: RecordCompensatingEntryCommand = {
      externalOperationId: operation.id,
      settlementId: settled.settlement.settlementId,
      suspenseEntryId: suspense.suspenseId,
      expectedVersion: settled.settlement.settlementVersion,
      requestContext,
    };
    const first = await service.recordCompensatingEntry(command);
    const second = await service.recordCompensatingEntry(command);

    expect(second.settlement.reversalJournalId).toBe(first.settlement.reversalJournalId);
    const journals: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM ledger_journals',
    );
    expect(journals).toHaveLength(3); // seeding + settlement + one compensation only
  });

  describe('chk_external_settlements_posted_journal (the A6T08 correction)', () => {
    it('still forbids a reversal reference on a POSTED settlement', async () => {
      const operation = await seedOperation();
      const settled = await service.settleVerifiedOutcome(settleCommand(operation));
      await expect(
        dataSource.query(
          `UPDATE external_settlements SET reversal_journal_id = $1, reversal_posted_at = now()
            WHERE id = $2`,
          [randomUUID(), settled.settlement.settlementId],
        ),
      ).rejects.toBeTruthy();
    });

    it('requires a reversal reference once the settlement is REVERSED', async () => {
      const operation = await seedOperation();
      const settled = await service.settleVerifiedOutcome(settleCommand(operation));
      await expect(
        dataSource.query(`UPDATE external_settlements SET status = 'REVERSED' WHERE id = $1`, [
          settled.settlement.settlementId,
        ]),
      ).rejects.toBeTruthy();
    });
  });

  it('rolls the whole settlement back when the enclosing transaction aborts', async () => {
    const operation = await seedOperation();
    const journalsBefore = await dataSource.query<Array<{ id: string }>>(
      'SELECT id FROM ledger_journals',
    );
    const customerBefore = await ledger.getAccountBalance(customerLedgerAccountId);
    const reserve = (
      await dataSource.query<Array<{ id: string }>>(
        `SELECT id FROM ledger_accounts WHERE code='PAYMENT-WITHDRAWAL_RESERVE-NGN'`,
      )
    )[0]!.id;
    const reserveBefore = await ledger.getAccountBalance(reserve);
    await expect(
      dataSource.transaction('SERIALIZABLE', async (manager) => {
        const posted = await service.settleVerifiedOutcomeInTransaction(
          manager,
          settleCommand(operation),
        );
        expect(posted.settlement.journalId).toBeTruthy();
        throw new Error('aborted');
      }),
    ).rejects.toThrow('aborted');
    expect(await dataSource.query('SELECT id FROM ledger_journals')).toHaveLength(
      journalsBefore.length,
    );
    expect(
      await dataSource.query('SELECT id FROM external_settlements WHERE external_operation_id=$1', [
        operation.id,
      ]),
    ).toHaveLength(0);
    expect(
      await dataSource.query(
        'SELECT state FROM financial_commitments WHERE external_operation_id=$1',
        [operation.id],
      ),
    ).toEqual([{ state: 'RESERVED' }]);
    expect((await ledger.getAccountBalance(customerLedgerAccountId)).balanceMinor).toBe(
      customerBefore.balanceMinor,
    );
    expect((await ledger.getAccountBalance(reserve)).balanceMinor).toBe(reserveBefore.balanceMinor);
    expect(
      (await service.settleVerifiedOutcome(settleCommand(operation))).settlement.journalId,
    ).toBeTruthy();
  });

  it('writes audit evidence for the settlement without contacting any partner', async () => {
    const operation = await seedOperation();
    const settled = await service.settleVerifiedOutcome(settleCommand(operation));
    const audits: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id FROM audit_events WHERE entity_id = $1`,
      [settled.settlement.settlementId],
    );
    expect(audits.length).toBeGreaterThan(0);
    // The partner boundary stayed disabled for the whole suite.
    expect(partnerEnv.A6_PARTNER_ENABLED).toBe('false');
  });
});
