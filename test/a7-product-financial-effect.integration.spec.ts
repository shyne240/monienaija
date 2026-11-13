import { WalletFinancialBoundaryService } from '../src/wallet/wallet-financial-boundary.service';
import { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import {
  KycTierEvidenceReader,
  type TierEvidenceSnapshot,
} from '../src/kyc-verification/kyc-tier-evidence.reader';
import { KycTierPolicyService } from '../src/kyc-verification/kyc-tier-policy.service';
/* eslint-disable */
import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';

import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';

import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyRecord } from '../src/operations/idempotency-record.entity';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { OutboxService } from '../src/operations/outbox.service';
import { MetricsService } from '../src/operations/metrics.service';

import { ExternalOperation } from '../src/partner/external-operation.entity';
import { ExternalOperationReference } from '../src/partner/external-operation-reference.entity';
import { ExternalOperationService } from '../src/partner/external-operation.service';
import { ExternalSettlement } from '../src/partner/external-settlement.entity';
import { ExternalSettlementDecision } from '../src/partner/external-settlement.enums';
import { ExternalOperationReferenceSource } from '../src/partner/external-operation.enums';
import { ExternalSuspenseEntry } from '../src/partner/external-suspense-entry.entity';
import { ExternalSettlementService } from '../src/partner/external-settlement.service';
import { PartnerConnectionService } from '../src/partner/partner-connection.service';
import { PartnerCapabilityRegistry } from '../src/partner/partner-capability.registry';
import { EnvironmentPartnerCredentialLoader } from '../src/partner/partner-credentials.service';
import { PartnerRequestSigningService } from '../src/partner/partner-request-signing.service';
import { SettlementAccountService } from '../src/payment/settlement-account.service';

import { A7ProductFinancialEffectService } from '../src/policy/a7-product-financial-effect.service';
import { A7ProductFinancialEffectRepository } from '../src/policy/a7-product-financial-effect.repository';
import type {
  A7ProductFinancialEffectA2AuthorizationContextView,
  A7ProductFinancialEffectA3BindingView,
  A7ProductFinancialEffectA4ProductPolicyDecisionView,
  A7ProductFinancialEffectA7T04ProductCustomerBindingMapView,
  A7ProductFinancialEffectA7T05ProductCommandView,
  A7ProductFinancialEffectA7T07ProductLifecycleView,
  A7ProductFinancialEffectConsumerPorts,
  A7ProductFinancialEffectV1,
} from '../src/policy/a7-product-financial-effect.types';

import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  seedTransferParticipant,
  truncateAllTables,
} from './support/pg-harness';

describe('A7 Product Financial Effect (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let ledger: LedgerService;
  let idempotency: IdempotencyService;
  let audit: AuditService;
  let outbox: OutboxService;
  let metrics: MetricsService;
  let externalSettlement: ExternalSettlementService;
  let a7Service: A7ProductFinancialEffectService;

  let customerLedgerAccountId: string;
  let settlementAssetLedgerAccountId: string;
  let externalOperationId: string;

  let seededCustomerId: string;
  let seededCustomerWalletId: string;
  let seededWalletAccountId: string;
  let seededBindingId: string;
  let seededProviderIdempotencyKey: string;
  let emergencyStop = false;
  let bypassSettlementLookup = false;
  let failA7Outbox = false;
  let operationVersion = 1;
  let overrideVerificationHash: string | null = null;
  let providerVerificationState:
    | 'VERIFIED_SETTLED'
    | 'VERIFIED_REJECTED'
    | 'UNKNOWN'
    | 'UNAVAILABLE' = 'VERIFIED_SETTLED';
  const snapshots = new Map<string, TierEvidenceSnapshot>();

  const A7T04_MAP_REFERENCE = sha256('a7t04-map-v1');
  const A7T05_COMMAND_REFERENCE = 'a7-product-command:v1:abc';
  const A7T07_LIFECYCLE_REFERENCE = sha256('a7t07-lifecycle-v1');
  const A6_EXTERNAL_OPERATION_REFERENCE = 'external-operation:v1:abc';
  const A6_PROVIDER_IDEMPOTENCY_SCOPE = 'nibss.nip.external-operation.v1';
  const A6_PROVIDER_IDEMPOTENCY_KEY = 'nibss.nip.external-operation.key.1';

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
    A6_PARTNER_SANDBOX_BASE_URL: 'https://a6-sandbox.invalid/settlement',
    A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE: 'local-integration-credential-reference',
    A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE: 'local-integration-signing-key-reference',
  };

  const mockConfigService = {
    get: (key: string): any => {
      if (key === 'A5_PILOT_EMERGENCY_STOP') {
        return emergencyStop;
      }
      return partnerEnv[key];
    },
  } as unknown as ConfigService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a7financial');

    // Test-only evidence adapter; the production financial eligibility and wallet
    // boundaries and ledger are real. The adapter cannot be selected in production.
    const reader = new KycTierEvidenceReader();
    reader.read = (_manager, id) => Promise.resolve(snapshots.get(id) ?? null);
    const policy = new KycTierPolicyService(dataSource, {} as never);
    const boundary = new WalletFinancialBoundaryService(
      new CustomerFinancialEligibilityService(policy, reader),
    );
    ledger = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
      boundary,
    );
    idempotency = new IdempotencyService(
      dataSource.getRepository(IdempotencyRecord),
      mockConfigService,
    );
    audit = new AuditService(dataSource.getRepository(AuditEvent));
    outbox = new OutboxService(dataSource.getRepository(OutboxEvent));
    metrics = new MetricsService(dataSource);

    const connection = new PartnerConnectionService(
      mockConfigService,
      new PartnerCapabilityRegistry(),
      new EnvironmentPartnerCredentialLoader(mockConfigService),
      new PartnerRequestSigningService(),
    );
    const operations = new ExternalOperationService(
      dataSource.getRepository(ExternalOperation),
      dataSource.getRepository(ExternalOperationReference),
      dataSource,
      idempotency,
      audit,
      connection,
      boundary,
    );

    externalSettlement = new ExternalSettlementService(
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
        verify: ({ operation }) =>
          Promise.resolve({
            state: providerVerificationState,
            providerStatus: 'test-only',
            providerReferenceHash:
              overrideVerificationHash ?? sha256(operation.providerReferences[0]!.referenceValue),
            observedAt: new Date().toISOString(),
            reasonCode: null,
          }),
      },
    );

    // Build the A7 ports that bridge the transactional, write-heavy, and balance-asserting domain logic to the real PG database
    const consumerPorts: A7ProductFinancialEffectConsumerPorts = {
      a2AuthorizationContextLookup:
        (): Promise<A7ProductFinancialEffectA2AuthorizationContextView | null> =>
          Promise.resolve({
            principalType: 'SERVICE' as const,
            principalId: 'a7-product-financial-effect',
            customerId: null,
            customerAccess: 'ANY' as const,
            evaluatedAt: new Date().toISOString(),
            allowed: true,
            action: 'a7-product-financial-effect',
            resourceType: 'A7_PRODUCT_FINANCIAL_EFFECT',
            resourceId: null,
          }),
      a3BindingRecheck: (cmd): Promise<A7ProductFinancialEffectA3BindingView | null> =>
        Promise.resolve({
          bindingId: cmd.bindingId,
          customerId: cmd.customerId,
          customerWalletId: cmd.customerWalletId,
          walletAccountId: cmd.bindingId,
          ledgerAccountId: customerLedgerAccountId,
          bindingVersion: 1,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
        }),
      a4ProductPolicyDecisionLookup:
        (): Promise<A7ProductFinancialEffectA4ProductPolicyDecisionView | null> =>
          Promise.resolve({
            decisionReference: 'a4-policy-ref',
            productKey: 'VIRTUAL_ACCOUNT',
            capability: 'virtual-account.inbound-funding',
            action: 'lifecycle',
            profileReference: 'policy-profile-ref',
            policyVersion: '1',
            decision: 'ALLOW_WITH_LIMITS' as const,
            expiresAt: null,
            reasonCodes: [],
            maxAmountMinor: null,
          }),
      a6ExternalOperationLookup: async (externalOperationReference) => ({
        version: operationVersion,
        providerReferences: (
          await operations.getInTransaction(dataSource.manager, externalOperationId)
        ).providerReferences,
        externalOperationId,
        externalOperationReference,
        partnerKey: 'NIBSS_NIP',
        capabilityKey: 'external.wallet.withdrawal.settlement',
        operationType: 'OUTBOUND_BANK_SETTLEMENT',
        customerId: seededCustomerId,
        walletAccountId: seededWalletAccountId,
        ledgerAccountId: customerLedgerAccountId,
        amountMinor: '1000',
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        providerIdempotencyScope: A6_PROVIDER_IDEMPOTENCY_SCOPE,
        providerIdempotencyKey: seededProviderIdempotencyKey,
        lifecycleState: 'PENDING_VERIFICATION',
        attemptCount: 1,
        maxAttempts: 3,
        replayed: false,
      }),
      a6LifecycleLookup: (externalOperationReference) =>
        Promise.resolve({
          externalOperationId,
          externalOperationReference,
          lifecycleState: 'PENDING_VERIFICATION',
          partnerKey: 'NIBSS_NIP',
          capabilityKey: 'external.wallet.withdrawal.settlement',
          attemptCount: 1,
          maxAttempts: 3,
          providerStatus: null,
          failureCode: null,
          failureMessage: null,
          providerIdempotencyScope: A6_PROVIDER_IDEMPOTENCY_SCOPE,
          providerIdempotencyKey: seededProviderIdempotencyKey,
          replayed: false,
        }),
      a6StatusVerification: () =>
        Promise.resolve({
          state: 'VERIFIED_SETTLED' as const,
          providerStatus: null,
          providerReferenceHash: sha256(`provider-settlement-${externalOperationId}`),
          observedAt: new Date().toISOString(),
          reasonCode: null,
        }),
      a6CircuitBreaker: () =>
        Promise.resolve({
          partnerKey: 'NIBSS_NIP',
          capabilityKey: 'external.wallet.withdrawal.settlement',
          state: 'CLOSED' as const,
          openedAt: null,
          cooldownSeconds: 0,
          reasonCode: null,
        }),
      a7T04ProductCustomerBindingMapReferenceCheck: (
        ref,
        cId,
        wId,
        bId,
        bV,
        pKey,
        capKey,
        act,
        pState,
      ): Promise<A7ProductFinancialEffectA7T04ProductCustomerBindingMapView | null> =>
        Promise.resolve({
          mapReference: ref,
          productKey: 'VIRTUAL_ACCOUNT',
          productVersion: 1,
          capabilityKey: capKey,
          action: act,
          productState: pState,
          customerId: cId,
          customerWalletId: wId,
          bindingId: bId,
          bindingVersion: bV,
          a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
          a2AuthorizationContextReference: 'a2-authorization-context',
        }),
      a7T05ProductCommandLookup: (
        ref,
        cId,
        wId,
        bId,
        bV,
        pKey,
        capKey,
        act,
        pState,
        amountMinor,
        currency,
        accountingUnit,
      ): Promise<A7ProductFinancialEffectA7T05ProductCommandView | null> =>
        Promise.resolve({
          productCommandReference: ref,
          productOperationReference: ref,
          productKey: pKey,
          productVersion: 1,
          capabilityKey: capKey,
          action: act,
          productState: pState,
          operationState: 'COMMAND_ADMITTED',
          customerId: cId,
          customerWalletId: wId,
          bindingId: bId,
          bindingVersion: bV,
          amountMinor,
          currency,
          accountingUnit,
        }),
      a7T07ProductLifecycleLookup: (
        ref,
        cId,
        wId,
        bId,
        bV,
        pKey,
        capKey,
        act,
        pState,
      ): Promise<A7ProductFinancialEffectA7T07ProductLifecycleView | null> =>
        Promise.resolve({
          productLifecycleReference: ref,
          productLifecycleId: ref,
          productKey: pKey,
          capabilityKey: capKey,
          action: act,
          productState: pState,
          currentLifecycleState: 'PENDING_VERIFICATION',
          outcome: 'OUTCOME_VERIFIED',
          customerId: cId,
          customerWalletId: wId,
          bindingId: bId,
          bindingVersion: bV,
        }),
      a6T08SettlementLookup: async (ref) => {
        if (bypassSettlementLookup || ref !== A6_EXTERNAL_OPERATION_REFERENCE) return null;
        return externalSettlement.getByOperation(externalOperationId);
      },
      a6T08SuspenseLookup: async (ref) => {
        if (ref !== A6_EXTERNAL_OPERATION_REFERENCE) return null;
        return externalSettlement.getSuspenseForOperation(externalOperationId);
      },
      a5LedgerJournalLookup: (journalId, manager) => {
        const mgr = manager ?? dataSource.manager;
        return Promise.all([
          mgr.getRepository(LedgerJournal).findOne({ where: { id: journalId } }),
          mgr
            .getRepository(LedgerLine)
            .find({ where: { journalId }, order: { lineNumber: 'ASC' } }),
        ])
          .then(([journal, lines]) => {
            if (!journal) {
              return null;
            }
            const lineViews = lines.map((line) => ({
              id: line.id,
              journalId: line.journalId,
              accountId: line.ledgerAccountId,
              lineNumber: line.lineNumber,
              direction: line.direction as any,
              amountMinor: line.amountMinor.toString(),
              currency: line.currency,
              accountingUnit: line.accountingUnit,
              createdAt: line.createdAt,
            }));
            return {
              journalId: journal.id,
              idempotencyKey: journal.idempotencyKey,
              currency: journal.currency,
              accountingUnit: journal.accountingUnit,
              totalMinor: journal.totalMinor.toString(),
              status: journal.status as any,
              reference: journal.reference,
              reversalOfJournalId: journal.reversalOfJournalId,
              createdAt: journal.createdAt.toISOString(),
              postedAt: journal.postedAt.toISOString(),
              lines: lineViews,
            };
          })
          .catch(() => {
            return null;
          });
      },
      a5LedgerAccountLookup: (accountId) =>
        ledger.getAccount(accountId).then((a) => ({
          accountId: a.id,
          code: a.code,
          name: a.name,
          accountType: a.accountType,
          normalBalance: a.normalBalance,
          currency: a.currency,
          accountingUnit: a.accountingUnit,
          allowNegativeBalance: a.allowNegativeBalance,
          isActive: a.isActive,
        })),
      a5LedgerEnabled: () =>
        Promise.resolve(
          emergencyStop
            ? {
                enabled: false,
                reason: 'A5_PILOT_EMERGENCY_STOP',
                disabledAt: new Date().toISOString(),
              }
            : { enabled: true, reason: null, disabledAt: null },
        ),
      a5LedgerInvariantCheck: () => Promise.resolve({ satisfied: true, reason: null }),
      a6T08SettleVerifiedOutcome: (cmd, manager) =>
        externalSettlement.settleVerifiedOutcomeInTransaction(manager, cmd),
      a6T08RecordSuspense: (cmd, manager) =>
        externalSettlement.recordSuspenseInTransaction(manager, cmd),
      a6T08RecordCompensatingEntry: (cmd, manager) =>
        externalSettlement.recordCompensatingEntryInTransaction(manager, cmd),
      a5LedgerPostJournal: (cmd) => ledger.postJournal(cmd),
      a5LedgerReverseJournal: () => {
        throw new Error('independent A5 reversal must not be called');
      },
      a5LedgerCustomerFundsAccountLookup: () => Promise.resolve(null),
      a5LedgerSettlementAssetAccountLookup: () => Promise.resolve(null),
      operationsIdempotencyReserve: (manager, cmd) => idempotency.reserve(manager, cmd),
      operationsIdempotencyComplete: (manager, recordId, cmd) =>
        idempotency.complete(manager, recordId, cmd),
      operationsIdempotencyFail: (manager, recordId, cmd) =>
        idempotency.fail(manager, recordId, {
          ...cmd,
          resourceId: cmd.resourceId ?? undefined,
        }),
      operationsAudit: (manager, record) => audit.record(manager, record).then(() => {}),
      operationsOutboxEnqueue: (manager, cmd) => {
        if (failA7Outbox) throw new Error('injected A7 outbox interruption');
        return outbox
          .enqueueOnce(manager, { ...cmd, causationId: cmd.causationId ?? undefined })
          .then(() => {});
      },
      operationsMetricsIncrement: (manager, metricName, amount) =>
        metrics.increment(manager, metricName, amount ?? 1),
    };

    const stubRepository = {
      getDataSource: () => dataSource,
      getA7ProductFinancialEffectProviderIdempotencyScope: () => A6_PROVIDER_IDEMPOTENCY_SCOPE,
      getConsumerPorts: () => consumerPorts,
    } as unknown as A7ProductFinancialEffectRepository;

    a7Service = new A7ProductFinancialEffectService(stubRepository);
  }, 180000);

  afterAll(async () => {
    if (dataSource) {
      await destroyIntegrationDataSource(dataSource);
    }
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    emergencyStop = false;
    failA7Outbox = false;
    operationVersion = 1;
    providerVerificationState = 'VERIFIED_SETTLED';
    overrideVerificationHash = null;
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
      `INSERT INTO kyc_tier_policy_proposals(id,request_id,expected_version,definition,fingerprint,maker_id,maker_session_id,checker_id,checker_session_id,state) VALUES($1,$2,0,$3,$4,'maker',$5,'checker',$6,'APPROVED')`,
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
    partnerEnv.A6_PARTNER_ENABLED = 'false';
    externalOperationId = randomUUID();

    // Seed customer funds liability account
    const suffix = randomUUID().slice(0, 8);
    const customer = await ledger.createAccount({
      code: `A7-CUST-${suffix}`,
      name: 'Customer liability',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
    customerLedgerAccountId = customer.id;

    // Seed payment settlement asset account
    const asset = await ledger.createAccount({
      code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
      name: 'Settlement asset',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    settlementAssetLedgerAccountId = asset.id;

    // Fund the customer liability account so the settlement debit has enough funds
    await ledger.postJournal({
      idempotencyKey: `a7-seed-${suffix}`,
      reference: `a7-seed-${suffix}`,
      description: 'Initial funding',
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

  // ---------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------

  async function seedExternalOperation(
    lifecycleState = 'PENDING_VERIFICATION',
    customOpId?: string,
    customRefValue?: string,
  ): Promise<{
    opId: string;
    refValue: string;
    providerValue: string;
    providerIdempotencyKey: string;
    customerId: string;
    walletId: string;
    bindingId: string;
  }> {
    const opId = customOpId || externalOperationId;
    const refValue = customRefValue || A6_EXTERNAL_OPERATION_REFERENCE;
    const providerIdempotencyKey = `provider-key-a7-${opId.slice(0, 8)}`;

    // Seed a unique customer liability account for each operation to avoid uq_wallet_accounts_ledger_account violations!
    const suffix = randomUUID().slice(0, 8);
    const customer = await ledger.createAccount({
      code: `A7-CUST-${suffix}`,
      name: `Customer liability ${suffix}`,
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
    const customerAccId = customer.id;

    // Seed the initial funding for the new customer account so it is transactionally valid
    await ledger.postJournal({
      idempotencyKey: `a7-seed-${suffix}`,
      reference: `a7-seed-${suffix}`,
      description: 'Initial funding',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        {
          accountId: settlementAssetLedgerAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: '100000',
        },
        { accountId: customerAccId, direction: LedgerEntryDirection.CREDIT, amountMinor: '100000' },
      ],
    });

    const participant = await seedTransferParticipant(dataSource, `a7_${suffix}`, customerAccId);
    await dataSource.query(
      `INSERT INTO customer_contact_methods(customer_id,type,value,normalized_value,is_primary,verified_at) VALUES($1,'PHONE',$2,$2,true,clock_timestamp())`,
      [participant.customerId, `P${randomUUID()}`],
    );
    await dataSource.query(
      `INSERT INTO customer_kyc_assessments(customer_id,kyc_level,kyc_status,assessed_by,expires_at) VALUES($1,'LEVEL_1','APPROVED','fixture',clock_timestamp()+interval '1 hour')`,
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
    seededCustomerId = participant.customerId;
    seededCustomerWalletId = participant.customerWalletId;
    seededWalletAccountId = participant.walletAccountId;
    seededBindingId = participant.bindingId;
    customerLedgerAccountId = customerAccId;
    seededProviderIdempotencyKey = providerIdempotencyKey;

    const withdrawalId = randomUUID();
    await dataSource.query(
      `INSERT INTO withdrawals (id, wallet_id, payment_reference, amount_minor, currency, status,
         idempotency_key, request_hash)
       VALUES ($1, $2, $3, '1000', 'NGN', 'PENDING', $4, $5)`,
      [
        withdrawalId,
        participant.walletAccountId,
        `wd-a7-ref-${opId.slice(0, 8)}`,
        `wd-a7-idemp-key-${opId.slice(0, 8)}`,
        sha256(`wd-a7-ref-${opId.slice(0, 8)}`),
      ],
    );

    // Seed real external_operation row
    await dataSource.query(
      `INSERT INTO external_operations
        (id, operation_version, partner_key, capability_key, operation_type, resource_type,
         resource_id, internal_command_id, customer_id, wallet_account_id, ledger_account_id,
         target_mapping_reference, amount_minor, currency, accounting_unit,
         internal_idempotency_scope, internal_idempotency_key, provider_idempotency_scope,
         provider_idempotency_key, request_hash, request_id, correlation_id, trace_id,
         lifecycle_state, attempt_count, max_attempts, version)
       VALUES ($1, 1, 'NIBSS_NIP', 'external.wallet.withdrawal.settlement',
               'OUTBOUND_BANK_SETTLEMENT', 'WITHDRAWAL', $2, $3, $4, $5, $6,
               $7, '1000', 'NGN', 'CUSTOMER_FUNDS',
               'external.partner.operation.v1', $8, $9,
               $10, $11, 'request-1', 'correlation-1', 'trace-1',
               $12, 1, 3, $13)`,
      [
        opId,
        withdrawalId,
        randomUUID(),
        seededCustomerId,
        seededWalletAccountId,
        customerLedgerAccountId,
        `a6-target:${sha256(opId)}`,
        `operation-key-a7-${opId.slice(0, 8)}`,
        A6_PROVIDER_IDEMPOTENCY_SCOPE,
        providerIdempotencyKey,
        sha256(`request-a7-${opId.slice(0, 8)}`),
        lifecycleState,
        operationVersion,
      ],
    );

    // Seed verified evidence reference
    await dataSource.query(
      `INSERT INTO external_operation_references
         (id, external_operation_id, partner_key, reference_type, reference_value, namespace,
          source, observed_at)
       VALUES ($1, $2, 'NIBSS_NIP', 'TRANSACTION', $3, 'nibss.nip', 'STATUS_QUERY', now())`,
      [randomUUID(), opId, `provider-settlement-${opId}`],
    );

    return {
      opId,
      refValue,
      providerValue: `provider-settlement-${opId}`,
      providerIdempotencyKey,
      customerId: seededCustomerId,
      walletId: seededCustomerWalletId,
      bindingId: seededBindingId,
    };
  }

  function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }

  function deriveRequestHash(command: any): string {
    const input = {
      contractName: 'A7-PRODUCT-FINANCIAL-EFFECT',
      contractVersion: 1,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customerId: command.customerId.toLowerCase(),
      customerWalletId: command.customerWalletId.toLowerCase(),
      bindingId: command.bindingId.toLowerCase(),
      bindingVersion: command.bindingVersion,
      amountMinor: command.amountMinor.toString(),
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      outcome: command.outcome,
      a7ProductLifecycleReference: command.a7ProductLifecycleReference,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6LifecycleState: command.a6LifecycleState,
      recoveryReference: command.recoveryReference,
      correlationId: command.requestContext.correlationId,
      causationId: command.causationId,
    };
    return sha256(canonicalJson(input));
  }

  function buildEnvelope(
    outcome = 'OUTCOME_VERIFIED',
    customRef?: string,
    customProviderKey?: string,
    customCustomerId?: string,
    customWalletId?: string,
    customBindingId?: string,
  ): A7ProductFinancialEffectV1 {
    const ref = customRef || A6_EXTERNAL_OPERATION_REFERENCE;
    const providerKey = customProviderKey || seededProviderIdempotencyKey;
    const custId = customCustomerId || seededCustomerId;
    const walletId = customWalletId || seededCustomerWalletId;
    const bindingId = customBindingId || seededBindingId;

    const envelopeBase: any = {
      contractName: 'A7-PRODUCT-FINANCIAL-EFFECT',
      contractVersion: 1,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: 'virtual-account.inbound-funding',
      action: 'lifecycle',
      productState: 'FUNDING_PENDING_VERIFICATION',
      customerId: custId,
      customerWalletId: walletId,
      bindingId,
      bindingVersion: 1,
      amountMinor: '1000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      outcome,
      a7ProductLifecycleReference: A7T07_LIFECYCLE_REFERENCE,
      a7ProductCommandReference: A7T05_COMMAND_REFERENCE,
      a7T04ProductCustomerBindingMapReference: A7T04_MAP_REFERENCE,
      a6ExternalOperationReference: ref,
      a6LifecycleState: 'PENDING_VERIFICATION',
      a6ProviderIdempotencyScope: A6_PROVIDER_IDEMPOTENCY_SCOPE,
      a6ProviderIdempotencyKey: providerKey,
      a2AuthorizationContextReference: 'a2-auth-context-ref',
      a4ProductPolicyDecisionReference: 'a4-policy-ref',
      a6T08SettlementReference: null,
      a6T08SuspenseReference: null,
      a6T08CompensatingReference: null,
      recoveryReference: null,
      reversalReason: null,
      failureCode: null,
      failureMessage: null,
      providerStatus: null,
      idempotencyKey: `a7-financial-key-${randomUUID()}`,
      requestContext: {
        requestId: 'req-a7-financial',
        correlationId: 'corr-a7-financial',
        traceId: 'trace-a7-financial',
      },
      causationId: null,
    };
    envelopeBase.requestHash = deriveRequestHash(envelopeBase);
    return envelopeBase;
  }

  async function dbBalanceOf(accountId: string): Promise<bigint> {
    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance
         FROM ledger_lines WHERE ledger_account_id = $1`,
      [accountId],
    );
    return BigInt(firstRow(rows, 'db balance').balance);
  }

  // =======================================================================================
  // 5. OUTCOME_VERIFIED / SETTLE
  // =======================================================================================
  describe('OUTCOME_VERIFIED / SETTLE', () => {
    it('does not debit outbound withdrawal funds for an inbound funding envelope', async () => {
      const operation = await seedExternalOperation();
      const before = await dbBalanceOf(customerLedgerAccountId);
      const envelope = buildEnvelope('OUTCOME_VERIFIED');
      await expect(a7Service.postProductFinancialEffect(envelope)).rejects.toThrow(
        'cannot use the outbound withdrawal boundary',
      );
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(before);
      expect(await externalSettlement.getByOperation(operation.opId)).toBeNull();
      const commitments = await dataSource.query(
        'SELECT id FROM financial_commitments WHERE external_operation_id=$1',
        [operation.opId],
      );
      expect(commitments).toHaveLength(0);
      expect(
        await dataSource.query('SELECT id FROM idempotency_records WHERE idempotency_key=$1', [
          envelope.idempotencyKey,
        ]),
      ).toHaveLength(0);
    });

    it('rolls back the A7 reservation when settlement reports a temporary dependency outage', async () => {
      await seedExternalOperation();
      const envelope = buildEnvelope('OUTCOME_VERIFIED');
      const failure = jest
        .spyOn(externalSettlement, 'settleVerifiedOutcomeInTransaction')
        .mockRejectedValue(new ServiceUnavailableException('Trusted KYC evidence is unavailable'));
      try {
        for (let i = 0; i < 2; i++) {
          await expect(a7Service.postProductFinancialEffect(envelope)).rejects.toMatchObject({
            status: 503,
          });
          const records = await dataSource.query(
            'SELECT id FROM idempotency_records WHERE idempotency_key = $1',
            [envelope.idempotencyKey],
          );
          expect(records).toHaveLength(0);
          expect(await dbBalanceOf(customerLedgerAccountId)).toBe(100000n);
        }
        expect(failure).toHaveBeenCalledTimes(2);
      } finally {
        failure.mockRestore();
      }
      const recovered = await a7Service.postProductFinancialEffect(envelope);
      expect(recovered.valid).toBe(true);
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
    });

    it('does not treat an uncommitted operation as an eligibility exception', async () => {
      const op = await seedExternalOperation();
      const cmd = {
        externalOperationId: op.opId,
        decision: 'SETTLE' as any,
        expectedVersion: 1,
        evidence: {
          referenceType: 'TRANSACTION' as const,
          referenceValue: op.providerValue,
          namespace: 'nibss.nip',
          source: 'STATUS_QUERY' as any,
          observedAt: new Date(),
        },
        requestContext: {
          requestId: 'uncommitted',
          correlationId: 'uncommitted',
          traceId: 'uncommitted',
        },
      };
      await dataSource.query(`UPDATE customers SET status='SUSPENDED' WHERE id=$1`, [
        op.customerId,
      ]);
      await expect(externalSettlement.settleVerifiedOutcome(cmd)).rejects.toThrow();
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(100000n);
      expect(await externalSettlement.getByOperation(op.opId)).toBeNull();
      await dataSource.query(`UPDATE customers SET status='ACTIVE' WHERE id=$1`, [op.customerId]);
      expect((await externalSettlement.settleVerifiedOutcome(cmd)).settlement.status).toBe(
        'POSTED',
      );
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
    });

    it('concurrent settlement creates exactly one journal and replays it', async () => {
      const op = await seedExternalOperation();
      const cmd = {
        externalOperationId: op.opId,
        decision: 'SETTLE' as any,
        expectedVersion: 1,
        evidence: {
          referenceType: 'TRANSACTION' as const,
          referenceValue: op.providerValue,
          namespace: 'nibss.nip',
          source: 'STATUS_QUERY' as any,
          observedAt: new Date(),
        },
        requestContext: {
          requestId: 'concurrent-settlement',
          correlationId: 'concurrent-settlement',
          traceId: 'concurrent-settlement',
        },
      };
      const outcomes = await Promise.allSettled([
        externalSettlement.settleVerifiedOutcome(cmd),
        externalSettlement.settleVerifiedOutcome(cmd),
      ]);
      expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
      const replay = await externalSettlement.settleVerifiedOutcome(cmd);
      expect(replay.replayed).toBe(true);
      expect(
        await dataSource.query(
          'SELECT count(*)::int AS n FROM external_settlements WHERE external_operation_id=$1',
          [op.opId],
        ),
      ).toEqual([{ n: 1 }]);
      expect(
        await dataSource.query('SELECT count(*)::int AS n FROM ledger_journals WHERE id=$1', [
          replay.settlement.journalId,
        ]),
      ).toEqual([{ n: 1 }]);
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
    });

    it('rejects missing settlement evidence without a financial journal', async () => {
      const op = await seedExternalOperation();
      await dataSource.query(
        'DELETE FROM external_operation_references WHERE external_operation_id=$1',
        [op.opId],
      );
      await expect(
        a7Service.postProductFinancialEffect(buildEnvelope('OUTCOME_VERIFIED')),
      ).rejects.toThrow();
      expect(await externalSettlement.getByOperation(op.opId)).toBeNull();
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(100000n);
    });

    it('rejects unverified or mismatched provider success and allows a verified retry', async () => {
      const op = await seedExternalOperation();
      const cmd = {
        externalOperationId: op.opId,
        decision: ExternalSettlementDecision.SETTLE,
        expectedVersion: 1,
        evidence: {
          referenceType: 'TRANSACTION' as const,
          referenceValue: op.providerValue,
          namespace: 'nibss.nip',
          source: ExternalOperationReferenceSource.STATUS_QUERY,
          observedAt: new Date(),
        },
        requestContext: {
          requestId: 'verification',
          correlationId: 'verification',
          traceId: 'verification',
        },
      };
      for (const state of ['UNKNOWN', 'UNAVAILABLE', 'VERIFIED_REJECTED'] as const) {
        providerVerificationState = state;
        await expect(externalSettlement.settleVerifiedOutcome(cmd)).rejects.toThrow();
        expect(await externalSettlement.getByOperation(op.opId)).toBeNull();
        expect(await dbBalanceOf(customerLedgerAccountId)).toBe(100000n);
      }
      providerVerificationState = 'VERIFIED_SETTLED';
      overrideVerificationHash = sha256('fabricated-provider-reference');
      await expect(externalSettlement.settleVerifiedOutcome(cmd)).rejects.toThrow();
      expect(await externalSettlement.getByOperation(op.opId)).toBeNull();
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(100000n);
      overrideVerificationHash = null;
      const posted = await externalSettlement.settleVerifiedOutcome(cmd);
      expect(posted.settlement.status).toBe('POSTED');
      expect((await externalSettlement.settleVerifiedOutcome(cmd)).replayed).toBe(true);
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
    });

    it('uses the persisted operation version for settlement', async () => {
      operationVersion = 2;
      await seedExternalOperation();
      const result = await a7Service.postProductFinancialEffect(buildEnvelope('OUTCOME_VERIFIED'));
      expect(result.valid).toBe(true);
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
    });

    it('successfully posts a verified product financial effect mapping to A5 balanced journal', async () => {
      await seedExternalOperation();
      const envelope = buildEnvelope('OUTCOME_VERIFIED');

      const result = await a7Service.postProductFinancialEffect(envelope);
      if (!result.valid) {
        console.log('FAILURE LOG DETAILED:', JSON.stringify((result as any).failure, null, 2));
      }

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.record.currentState).toBe('FINANCIAL_EFFECT_SETTLEMENT_POSTED');
        expect(result.record.a6T08Decision).toBe('SETTLE');
        expect(result.record.a6T08Settlement).toBeTruthy();
        expect(result.record.a5LedgerJournal).toBeTruthy();

        const journalId = result.record.a5LedgerJournal!.journalId;
        const lines: Array<{ direction: string; amount_minor: string; ledger_account_id: string }> =
          await dataSource.query(
            'SELECT direction, amount_minor, ledger_account_id FROM ledger_lines WHERE journal_id = $1',
            [journalId],
          );
        expect(lines).toHaveLength(2);
        const debitLine = lines.find((l) => l.direction === 'DEBIT')!;
        const creditLine = lines.find((l) => l.direction === 'CREDIT')!;

        expect(debitLine.amount_minor).toBe('1000');
        expect(debitLine.ledger_account_id).toBe(customerLedgerAccountId);

        expect(creditLine.amount_minor).toBe('1000');
        expect(creditLine.ledger_account_id).toBe(settlementAssetLedgerAccountId);

        // Balances updated correctly
        expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
        expect(await dbBalanceOf(settlementAssetLedgerAccountId)).toBe(-199000n);

        // Audits and outbox entries checked
        const audits: Array<{ action: string }> = await dataSource.query(
          "SELECT action FROM audit_events WHERE entity_type = 'A7_PRODUCT_FINANCIAL_EFFECT' AND entity_id = $1",
          [result.record.productFinancialEffectId],
        );
        const actions = audits.map((a) => a.action);
        expect(actions).toContain('A7_PRODUCT_FINANCIAL_EFFECT_SETTLEMENT_POSTED');
        expect(actions).toContain('A7_PRODUCT_FINANCIAL_EFFECT_RESERVED');

        const outboxEvents: Array<{ event_type: string }> = await dataSource.query(
          "SELECT event_type FROM outbox_events WHERE aggregate_type = 'A7_PRODUCT_FINANCIAL_EFFECT' AND aggregate_id = $1",
          [result.record.productFinancialEffectId],
        );
        expect(outboxEvents[0]!.event_type).toBe('A7ProductFinancialEffectPosted');
      }
    });
  });

  // =======================================================================================
  // 6. SUSPENSE / UNKNOWN PATHS
  // =======================================================================================
  describe('Suspense and Unverified Outcomes', () => {
    it('records suspense for unverified outcomes and does not post a monetary journal', async () => {
      await seedExternalOperation();
      const envelope = buildEnvelope('OUTCOME_SUSPENSE');

      const result = await a7Service.postProductFinancialEffect(envelope);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.record.currentState).toBe('FINANCIAL_EFFECT_SUSPENSE_RECORDED');
        expect(result.record.a6T08Decision).toBe('SUSPENSE');
        expect(result.record.a6T08Settlement).toBeNull();
        expect(result.record.a6T08Suspense).toBeTruthy();
        expect(result.record.a5LedgerJournal).toBeNull();

        // Wallet balance untouched
        expect(await dbBalanceOf(customerLedgerAccountId)).toBe(100000n);

        // Verify suspense row is recorded in external_suspense_entries
        const suspenseRows: Array<{ reason: string }> = await dataSource.query(
          'SELECT reason FROM external_suspense_entries WHERE id = $1',
          [result.record.a6T08Suspense!.suspenseId],
        );
        expect(suspenseRows).toHaveLength(1);
        expect(suspenseRows[0]!.reason).toBe('PROVIDER_SUSPENSE');
      }
    });
  });

  // =======================================================================================
  // 7. REVERSAL
  // =======================================================================================
  describe('Product financial effect reversal', () => {
    it('successfully posts compensating entries reversing original directions', async () => {
      // First operation/suspense (posted first to populate suspense entry on same operation)
      const op1 = await seedExternalOperation();
      const suspenseEnvelope = buildEnvelope(
        'OUTCOME_SUSPENSE',
        op1.refValue,
        op1.providerIdempotencyKey,
        op1.customerId,
        op1.walletId,
        op1.bindingId,
      );
      (suspenseEnvelope as any).idempotencyKey = `a7-susp-key-${randomUUID()}`;
      (suspenseEnvelope as any).requestHash = deriveRequestHash(suspenseEnvelope);
      const suspenseResult = await a7Service.postProductFinancialEffect(suspenseEnvelope);
      expect(suspenseResult.valid).toBe(true);

      // Settle the same operation (which passes A6T08SettlementLookup since no settlement row existed yet)
      const postEnvelope = buildEnvelope(
        'OUTCOME_VERIFIED',
        op1.refValue,
        op1.providerIdempotencyKey,
        op1.customerId,
        op1.walletId,
        op1.bindingId,
      );
      const postResult = await a7Service.postProductFinancialEffect(postEnvelope);
      expect(postResult.valid).toBe(true);

      // Perform reversal on the first operation (which now has both settlement and suspense records!)
      const revEnvelope = buildEnvelope(
        'OUTCOME_REJECTED',
        op1.refValue,
        op1.providerIdempotencyKey,
        op1.customerId,
        op1.walletId,
        op1.bindingId,
      );
      if (postResult.valid && suspenseResult.valid) {
        (revEnvelope as any).a6T08SettlementReference =
          `a7-product-financial-effect-settlement:${sha256(
            postResult.record.productFinancialEffectId,
          )}`;
        (revEnvelope as any).a6T08SuspenseReference =
          `a7-product-financial-effect-suspense:${sha256(
            suspenseResult.record.productFinancialEffectId,
          )}`;
        (revEnvelope as any).recoveryReference = `a7-product-financial-effect-recovery:${sha256(
          postResult.record.productFinancialEffectId,
        )}`;
      }
      (revEnvelope as any).reversalReason = 'Chargeback requested';
      (revEnvelope as any).idempotencyKey = `a7-rev-key-${randomUUID()}`;
      (revEnvelope as any).requestHash = deriveRequestHash(revEnvelope);

      providerVerificationState = 'VERIFIED_REJECTED';
      await dataSource.query(
        `INSERT INTO kyc_tier_manual_holds(customer_id,actor,reason) VALUES($1,'test','MANUAL_REVIEW')`,
        [op1.customerId],
      );
      await expect(a7Service.postProductFinancialEffectReversal(revEnvelope)).rejects.toThrow(
        'restricted pending compliance review',
      );
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
      await dataSource.query(`DELETE FROM kyc_tier_manual_holds WHERE customer_id=$1`, [
        op1.customerId,
      ]);
      providerVerificationState = 'UNKNOWN';
      await expect(a7Service.postProductFinancialEffectReversal(revEnvelope)).rejects.toMatchObject(
        { code: 'COMPENSATING_NOT_PERMITTED' },
      );
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
      providerVerificationState = 'UNAVAILABLE';
      await expect(a7Service.postProductFinancialEffectReversal(revEnvelope)).rejects.toMatchObject(
        { status: 503 },
      );
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
      providerVerificationState = 'VERIFIED_REJECTED';
      overrideVerificationHash = sha256('another-operation-reference');
      await expect(a7Service.postProductFinancialEffectReversal(revEnvelope)).rejects.toMatchObject(
        { code: 'COMPENSATING_NOT_PERMITTED' },
      );
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
      overrideVerificationHash = null;
      failA7Outbox = true;
      try {
        await expect(a7Service.postProductFinancialEffectReversal(revEnvelope)).rejects.toThrow(
          'injected A7 outbox interruption',
        );
        expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
        const settlement = await dataSource.query(
          `SELECT status,reversal_journal_id FROM external_settlements WHERE external_operation_id=$1`,
          [op1.opId],
        );
        expect(settlement).toEqual([{ status: 'POSTED', reversal_journal_id: null }]);
        const reservation = await dataSource.query(
          `SELECT id FROM idempotency_records WHERE idempotency_key=$1`,
          [revEnvelope.idempotencyKey],
        );
        expect(reservation).toHaveLength(0);
        const reversals = await dataSource.query(
          `SELECT id FROM ledger_journals WHERE reversal_of_journal_id=$1`,
          [postResult.valid ? postResult.record.a6T08Settlement!.journalId : null],
        );
        expect(reversals).toHaveLength(0);
      } finally {
        failA7Outbox = false;
      }
      const result = await a7Service.postProductFinancialEffectReversal(revEnvelope);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.record.currentState).toBe('FINANCIAL_EFFECT_REVERSAL_POSTED');
        expect(result.record.a6T08Decision).toBe('REVERSE');
        expect(result.record.a6T08Compensating).toBeTruthy();
        expect(result.record.a5LedgerJournal).toBeTruthy();
        expect(result.record.a5LedgerJournal!.journalId).toBe(
          result.record.a6T08Compensating!.reversalJournalId,
        );
        const journalCount = await dataSource.query(
          `SELECT count(*)::int AS n FROM ledger_journals WHERE reversal_of_journal_id=$1`,
          [postResult.valid ? postResult.record.a6T08Settlement!.journalId : null],
        );
        expect(journalCount).toEqual([{ n: 1 }]);

        // Compensating journal directions exactly flipped: Credit Wallet, Debit Settlement asset
        const revLines: Array<{
          direction: string;
          amount_minor: string;
          ledger_account_id: string;
        }> = await dataSource.query(
          'SELECT direction, amount_minor, ledger_account_id FROM ledger_lines WHERE journal_id = $1',
          [result.record.a6T08Compensating!.reversalJournalId],
        );
        expect(revLines).toHaveLength(2);
        const debitLine = revLines.find((l) => l.direction === 'DEBIT')!;
        const creditLine = revLines.find((l) => l.direction === 'CREDIT')!;

        expect(debitLine.ledger_account_id).toBe(settlementAssetLedgerAccountId);
        expect(creditLine.ledger_account_id).toBe(customerLedgerAccountId);

        // Balances successfully return exactly to pre-posting state (100000)
        expect(await dbBalanceOf(customerLedgerAccountId)).toBe(100000n);
        expect(await dbBalanceOf(settlementAssetLedgerAccountId)).toBe(-200000n);
      }
    });

    it('concurrent compensation posts once and replays the committed result', async () => {
      const op = await seedExternalOperation();
      const suspense = await a7Service.postProductFinancialEffect(
        buildEnvelope(
          'OUTCOME_SUSPENSE',
          op.refValue,
          op.providerIdempotencyKey,
          op.customerId,
          op.walletId,
          op.bindingId,
        ),
      );
      const settled = await a7Service.postProductFinancialEffect(
        buildEnvelope(
          'OUTCOME_VERIFIED',
          op.refValue,
          op.providerIdempotencyKey,
          op.customerId,
          op.walletId,
          op.bindingId,
        ),
      );
      expect(suspense.valid).toBe(true);
      expect(settled.valid).toBe(true);
      if (!suspense.valid || !settled.valid) throw new Error('fixture not admitted');
      const original = settled.record.a6T08Settlement!.journalId!;
      const command = {
        externalOperationId: op.opId,
        settlementId: settled.record.a6T08Settlement!.settlementId,
        suspenseEntryId: suspense.record.a6T08Suspense!.suspenseId,
        expectedVersion: 1,
        requestContext: {
          requestId: 'concurrent',
          correlationId: 'concurrent',
          traceId: 'concurrent',
        },
      };
      providerVerificationState = 'VERIFIED_REJECTED';
      const outcomes = await Promise.allSettled([
        externalSettlement.recordCompensatingEntry(command),
        externalSettlement.recordCompensatingEntry(command),
      ]);
      expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
      const replay = await externalSettlement.recordCompensatingEntry(command);
      expect(replay.replayed).toBe(true);
      expect(
        await dataSource.query(
          `SELECT count(*)::int AS n FROM ledger_journals WHERE reversal_of_journal_id=$1`,
          [original],
        ),
      ).toEqual([{ n: 1 }]);
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(100000n);
      expect((await externalSettlement.getByOperation(op.opId))?.status).toBe('REVERSED');
    });

    it('keeps exhausted but uncertain outcomes for review until rejection is confirmed', async () => {
      const op = await seedExternalOperation();
      const suspense = await a7Service.postProductFinancialEffect(
        buildEnvelope(
          'OUTCOME_SUSPENSE',
          op.refValue,
          op.providerIdempotencyKey,
          op.customerId,
          op.walletId,
          op.bindingId,
        ),
      );
      const settled = await a7Service.postProductFinancialEffect(
        buildEnvelope(
          'OUTCOME_VERIFIED',
          op.refValue,
          op.providerIdempotencyKey,
          op.customerId,
          op.walletId,
          op.bindingId,
        ),
      );
      if (!suspense.valid || !settled.valid) throw new Error('fixture not admitted');
      await dataSource.query(
        `UPDATE external_operations SET lifecycle_state='FAILED', failure_code='RETRY_EXHAUSTED', failure_message='Exhausted for test', attempt_count=max_attempts WHERE id=$1`,
        [op.opId],
      );
      const command = {
        externalOperationId: op.opId,
        settlementId: settled.record.a6T08Settlement!.settlementId,
        suspenseEntryId: suspense.record.a6T08Suspense!.suspenseId,
        expectedVersion: 1,
        requestContext: {
          requestId: 'exhausted',
          correlationId: 'exhausted',
          traceId: 'exhausted',
        },
      };
      providerVerificationState = 'UNKNOWN';
      await expect(externalSettlement.recordCompensatingEntry(command)).rejects.toMatchObject({
        code: 'COMPENSATING_NOT_PERMITTED',
      });
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
      expect((await externalSettlement.getByOperation(op.opId))?.status).toBe('POSTED');
      providerVerificationState = 'VERIFIED_REJECTED';
      const recovered = await externalSettlement.recordCompensatingEntry(command);
      expect(recovered.settlement.status).toBe('REVERSED');
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(100000n);
      expect((await externalSettlement.recordCompensatingEntry(command)).replayed).toBe(true);
    });

    it('rejects double reversals of the same settlement', async () => {
      const op1 = await seedExternalOperation();
      // Post suspense first
      const suspenseEnvelope = buildEnvelope(
        'OUTCOME_SUSPENSE',
        op1.refValue,
        op1.providerIdempotencyKey,
        op1.customerId,
        op1.walletId,
        op1.bindingId,
      );
      (suspenseEnvelope as any).idempotencyKey = `a7-susp-key-${randomUUID()}`;
      (suspenseEnvelope as any).requestHash = deriveRequestHash(suspenseEnvelope);
      const suspenseResult = await a7Service.postProductFinancialEffect(suspenseEnvelope);

      // Settle
      const postResult = await a7Service.postProductFinancialEffect(
        buildEnvelope(
          'OUTCOME_VERIFIED',
          op1.refValue,
          op1.providerIdempotencyKey,
          op1.customerId,
          op1.walletId,
          op1.bindingId,
        ),
      );

      const revEnvelope1 = buildEnvelope(
        'OUTCOME_REJECTED',
        op1.refValue,
        op1.providerIdempotencyKey,
        op1.customerId,
        op1.walletId,
        op1.bindingId,
      );
      if (postResult.valid && suspenseResult.valid) {
        (revEnvelope1 as any).a6T08SettlementReference =
          `a7-product-financial-effect-settlement:${sha256(
            postResult.record.productFinancialEffectId,
          )}`;
        (revEnvelope1 as any).a6T08SuspenseReference =
          `a7-product-financial-effect-suspense:${sha256(
            suspenseResult.record.productFinancialEffectId,
          )}`;
        (revEnvelope1 as any).recoveryReference = `a7-product-financial-effect-recovery:${sha256(
          postResult.record.productFinancialEffectId,
        )}`;
      }
      (revEnvelope1 as any).reversalReason = 'Need reversal';
      (revEnvelope1 as any).idempotencyKey = `a7-rev-key-1-${randomUUID()}`;
      (revEnvelope1 as any).requestHash = deriveRequestHash(revEnvelope1);

      providerVerificationState = 'VERIFIED_REJECTED';
      const first = await a7Service.postProductFinancialEffectReversal(revEnvelope1);
      expect(first.valid).toBe(true);

      const revEnvelope2 = buildEnvelope(
        'OUTCOME_REJECTED',
        op1.refValue,
        op1.providerIdempotencyKey,
        op1.customerId,
        op1.walletId,
        op1.bindingId,
      );
      if (postResult.valid && suspenseResult.valid) {
        (revEnvelope2 as any).a6T08SettlementReference =
          `a7-product-financial-effect-settlement:${sha256(
            postResult.record.productFinancialEffectId,
          )}`;
        (revEnvelope2 as any).a6T08SuspenseReference =
          `a7-product-financial-effect-suspense:${sha256(
            suspenseResult.record.productFinancialEffectId,
          )}`;
        (revEnvelope2 as any).recoveryReference = `a7-product-financial-effect-recovery:${sha256(
          postResult.record.productFinancialEffectId,
        )}`;
      }
      (revEnvelope2 as any).reversalReason = 'Need reversal duplicate';
      (revEnvelope2 as any).idempotencyKey = `a7-rev-key-2-${randomUUID()}`;
      (revEnvelope2 as any).requestHash = deriveRequestHash(revEnvelope2);

      const second = await a7Service.postProductFinancialEffectReversal(revEnvelope2);
      expect(second.valid).toBe(false);
      if (!second.valid) {
        expect(second.failure.code).toBe('A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_DUPLICATE_SETTLEMENT');
      }
    });

    it('rejects the reversal when recoveryReference is missing', async () => {
      await seedExternalOperation();
      const envelope = buildEnvelope('OUTCOME_REJECTED');
      (envelope as any).recoveryReference = null;
      (envelope as any).requestHash = deriveRequestHash(envelope);

      const result = await a7Service.postProductFinancialEffectReversal(envelope);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.failure.code).toBe('A7_PRODUCT_FINANCIAL_EFFECT_RECOVERY_REFERENCE_MISSING');
      }
    });
  });

  // =======================================================================================
  // 8. IDEMPOTENCY
  // =======================================================================================
  describe('Idempotency checks', () => {
    it('replays identical financial effects and throws on request hash conflict', async () => {
      await seedExternalOperation();
      const envelope = buildEnvelope('OUTCOME_VERIFIED');
      // Set to bypass duplicate block via mock lookup so the idempotency replay is called!
      (envelope as any).idempotencyKey = 'a7-idemp-key-replay';
      (envelope as any).requestHash = deriveRequestHash(envelope);

      bypassSettlementLookup = true;
      const first = await a7Service.postProductFinancialEffect(envelope);
      const second = await a7Service.postProductFinancialEffect(envelope);
      bypassSettlementLookup = false;

      expect(first.valid).toBe(true);
      expect(second.valid).toBe(true);
      if (first.valid && second.valid) {
        expect(second.record.productFinancialEffectId).toBe(first.record.productFinancialEffectId);
        expect(second.record.replayed).toBe(true);
      }

      // Payload conflict
      const conflictingEnvelope = {
        ...envelope,
        a7ProductLifecycleReference: sha256('conflicting-lifecycle-ref'),
      };
      (conflictingEnvelope as any).requestHash = deriveRequestHash(conflictingEnvelope);

      bypassSettlementLookup = true;
      const conflictResult = await a7Service.postProductFinancialEffect(conflictingEnvelope);
      bypassSettlementLookup = false;
      expect(conflictResult.valid).toBe(false);
      if (!conflictResult.valid) {
        expect(conflictResult.failure.code).toBe(
          'A7_PRODUCT_FINANCIAL_EFFECT_REQUEST_HASH_CONFLICT',
        );
      }
    });
  });

  // =======================================================================================
  // 10. EMERGENCY STOP / FAIL-CLOSED
  // =======================================================================================
  describe('Emergency stop config behavior', () => {
    it('fails closed when pilot emergency stop flag is active', async () => {
      await seedExternalOperation();
      emergencyStop = true;

      const envelope = buildEnvelope('OUTCOME_VERIFIED');
      const result = await a7Service.postProductFinancialEffect(envelope);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.failure.code).toBe('A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_DISABLED');
        expect(result.failure.checks.a5LedgerEnabled).toBe('FAIL');
      }

      // No monetary journals or settlements posted in DB
      const journalsCount: Array<{ n: string }> = await dataSource.query(
        'SELECT count(*)::text as n FROM ledger_journals',
      );
      expect(firstRow(journalsCount, 'journals count').n).toBe('2'); // Seeding + seedExternalOperation journal
    });
  });

  // =======================================================================================
  // 12. ATOMIC ROLLBACK
  // =======================================================================================
  describe('Atomic Rollback Guarantee', () => {
    it('rolls settlement and A7 records back after an injected outbox interruption and retries', async () => {
      const op = await seedExternalOperation();
      const envelope = buildEnvelope('OUTCOME_VERIFIED');
      const initialJournals = await dataSource.query(
        'SELECT count(*)::int AS n FROM ledger_journals',
      );
      failA7Outbox = true;
      try {
        await expect(a7Service.postProductFinancialEffect(envelope)).rejects.toThrow(
          'injected A7 outbox interruption',
        );
        expect(await dataSource.query('SELECT count(*)::int AS n FROM ledger_journals')).toEqual(
          initialJournals,
        );
        expect(await externalSettlement.getByOperation(op.opId)).toBeNull();
        expect(
          await dataSource.query('SELECT id FROM idempotency_records WHERE idempotency_key=$1', [
            envelope.idempotencyKey,
          ]),
        ).toHaveLength(0);
        expect(await dbBalanceOf(customerLedgerAccountId)).toBe(100000n);
      } finally {
        failA7Outbox = false;
      }
      const recovered = await a7Service.postProductFinancialEffect(envelope);
      expect(recovered.valid).toBe(true);
      expect(await dbBalanceOf(customerLedgerAccountId)).toBe(99000n);
    });
  });
});
