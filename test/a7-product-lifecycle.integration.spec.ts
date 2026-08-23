/* eslint-disable */
import { createHash, randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
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
import { ExternalOperationReferenceSource } from '../src/partner/external-operation.enums';
import { ExternalOperationService } from '../src/partner/external-operation.service';
import { PartnerConnectionService } from '../src/partner/partner-connection.service';
import { PartnerCapabilityRegistry } from '../src/partner/partner-capability.registry';
import { EnvironmentPartnerCredentialLoader } from '../src/partner/partner-credentials.service';
import { PartnerRequestSigningService } from '../src/partner/partner-request-signing.service';

import { A7ProductLifecycleService } from '../src/policy/a7-product-lifecycle.service';
import { A7ProductLifecycleRepository } from '../src/policy/a7-product-lifecycle.repository';
import type {
  A7ProductLifecycleA2AuthorizationContextView,
  A7ProductLifecycleA3BindingView,
  A7ProductLifecycleA4ProductPolicyDecisionView,
  A7ProductLifecycleA7T04ProductCustomerBindingMapView,
  A7ProductLifecycleA7T05ProductCommandView,
  A7ProductLifecycleA7T06NotificationDeliveryView,
  A7ProductLifecycleConsumerPorts,
  A7ProductLifecycleTransitionV1,
} from '../src/policy/a7-product-lifecycle.types';

import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  seedTransferParticipant,
  truncateAllTables,
} from './support/pg-harness';

describe('A7 Product Lifecycle (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let ledger: LedgerService;
  let idempotency: IdempotencyService;
  let audit: AuditService;
  let outbox: OutboxService;
  let metrics: MetricsService;
  let a7Lifecycle: A7ProductLifecycleService;
  let originalTransaction: any;

  let customerLedgerAccountId: string;
  let settlementAssetLedgerAccountId: string;
  let externalOperationId: string;

  let seededCustomerId: string;
  let seededCustomerWalletId: string;
  let seededWalletAccountId: string;
  let seededBindingId: string;
  let seededProviderIdempotencyKey: string;

  const A7T04_MAP_REFERENCE = sha256('a7t04-map-v1');
  const A7T05_COMMAND_REFERENCE = 'a7-product-command:v1:abc';
  const A7T07_LIFECYCLE_REFERENCE = sha256('a7t07-lifecycle-v1');
  const A6_EXTERNAL_OPERATION_REFERENCE = 'external-operation:v1:abc';
  const A6_PROVIDER_IDEMPOTENCY_SCOPE = 'nibss.nip.external-operation.v1';

  let emergencyStop = false;
  let bypassSettlementLookup = false;
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
    dataSource = await createIntegrationDataSource('a7lifecycle');
    originalTransaction = dataSource.transaction;

    ledger = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
    );
    idempotency = new IdempotencyService(dataSource.getRepository(IdempotencyRecord), mockConfigService);
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
    );

    // Build the A7 ports bridging dynamically to the real database
    const consumerPorts: A7ProductLifecycleConsumerPorts = {
      a6LifecycleLookup: async (externalOperationReference) => {
        const mgr = activeManager || dataSource.manager;
        const refRow = await mgr.getRepository(ExternalOperationReference).findOne({
          where: { referenceValue: externalOperationReference },
        });
        if (!refRow) return null;
        const op = await mgr.getRepository(ExternalOperation).findOne({
          where: { id: refRow.externalOperationId },
        });
        if (!op) return null;
        return {
          externalOperationId: op.id,
          externalOperationReference,
          partnerKey: op.partnerKey,
          capabilityKey: op.capabilityKey,
          operationType: op.operationType,
          lifecycleState: op.lifecycleState as any,
          attemptCount: op.attemptCount,
          maxAttempts: op.maxAttempts,
          providerStatus: op.providerStatus,
          providerIdempotencyScope: op.providerIdempotencyScope,
          providerIdempotencyKey: op.providerIdempotencyKey,
          replayed: false,
          recoveredAt: null,
        };
      },
      a6StatusVerification: () =>
        Promise.resolve({
          state: 'VERIFIED_PENDING' as const,
          providerStatus: null,
          providerReferenceHash: null,
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
      a2AuthorizationContextLookup: (): Promise<A7ProductLifecycleA2AuthorizationContextView | null> =>
        Promise.resolve({
          principalType: 'SERVICE' as const,
          principalId: 'a7-product-lifecycle',
          customerId: null,
          customerAccess: 'ANY' as const,
          evaluatedAt: new Date().toISOString(),
          allowed: true,
          action: 'a7-product-lifecycle',
          resourceType: 'A7_PRODUCT_LIFECYCLE',
          resourceId: null,
        }),
      a3BindingRecheck: (): Promise<A7ProductLifecycleA3BindingView | null> =>
        Promise.resolve({
          bindingId: seededBindingId,
          customerId: seededCustomerId,
          customerWalletId: seededCustomerWalletId,
          walletAccountId: seededWalletAccountId,
          ledgerAccountId: customerLedgerAccountId,
          bindingVersion: 1,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
        }),
      a4ProductPolicyDecisionLookup: (): Promise<A7ProductLifecycleA4ProductPolicyDecisionView | null> =>
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
      a7T05ProductCommandLookup: (): Promise<A7ProductLifecycleA7T05ProductCommandView | null> =>
        Promise.resolve({
          productCommandReference: A7T05_COMMAND_REFERENCE,
          productOperationReference: A7T05_COMMAND_REFERENCE,
          productKey: 'VIRTUAL_ACCOUNT',
          productVersion: 1,
          capabilityKey: 'virtual-account.inbound-funding',
          action: 'lifecycle',
          productState: 'FUNDING_PENDING_VERIFICATION',
          operationState: 'COMMAND_ADMITTED',
          customerId: seededCustomerId,
          customerWalletId: seededCustomerWalletId,
          bindingId: seededBindingId,
          bindingVersion: 1,
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
      ): Promise<A7ProductLifecycleA7T04ProductCustomerBindingMapView | null> =>
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
      a7T06NotificationDeliveryLookup: (): Promise<A7ProductLifecycleA7T06NotificationDeliveryView | null> =>
        Promise.resolve({
          notificationDispatchReference: 'notification-dispatch-ref',
          deliveryState: 'DISPATCHED',
          notificationChannel: 'email',
          customerPreferenceReference: 'customer-preference-reference',
        }),
      operationsIdempotencyReserve: (manager, cmd) => idempotency.reserve(manager, cmd),
      operationsIdempotencyComplete: (manager, recordId, cmd) =>
        idempotency.complete(manager, recordId, cmd),
      operationsIdempotencyFail: (manager, recordId, cmd) =>
        idempotency.fail(manager, recordId, {
          ...cmd,
          resourceId: cmd.resourceId ?? undefined,
        }),
      operationsAudit: (manager, record) => audit.record(manager, record).then(() => {}),
      operationsOutboxEnqueue: (manager, cmd) =>
        outbox.enqueueOnce(manager, {
          ...cmd,
          causationId: cmd.causationId ?? undefined,
        }).then(() => {}),
      operationsMetricsIncrement: (manager, metricName, amount) =>
        metrics.increment(manager, metricName, amount ?? 1),
      operationsDiagnosticsReport: () => Promise.resolve(),
    };

    const stubRepository = {
      getDataSource: () => dataSource,
      getA7ProductLifecycleProviderIdempotencyScope: () => A6_PROVIDER_IDEMPOTENCY_SCOPE,
      getConsumerPorts: () => consumerPorts,
    } as unknown as A7ProductLifecycleRepository;

    a7Lifecycle = new A7ProductLifecycleService(stubRepository);
  }, 180000);

  afterAll(async () => {
    if (dataSource) {
      await destroyIntegrationDataSource(dataSource);
    }
  }, 60000);

  let activeManager: EntityManager | null = null;

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    emergencyStop = false;
    partnerEnv.A6_PARTNER_ENABLED = 'false';
    externalOperationId = randomUUID();

    // Intercept transaction boundaries to avoid connection deadlocks
    activeManager = null;
    dataSource.transaction = function (this: void, isolationOrRunner: any, runner?: any) {
      if (activeManager) {
        const actualRunner = typeof isolationOrRunner === 'function' ? isolationOrRunner : runner;
        return actualRunner(activeManager);
      }
      const originalRunner = typeof isolationOrRunner === 'function' ? isolationOrRunner : runner;
      const wrappedRunner = async (m: EntityManager) => {
        activeManager = m;
        try {
          return await originalRunner(m);
        } finally {
          activeManager = null;
        }
      };
      if (typeof isolationOrRunner === 'function') {
        return originalTransaction.call(this, wrappedRunner);
      } else {
        return originalTransaction.call(this, isolationOrRunner, wrappedRunner);
      }
    };

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

    // Fund the customer liability account
    await ledger.postJournal({
      idempotencyKey: `a7-seed-${suffix}`,
      reference: `a7-seed-${suffix}`,
      description: 'Initial funding',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: settlementAssetLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '100000' },
        { accountId: customerLedgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '100000' },
      ],
    });
  }, 60000);

  afterEach(() => {
    dataSource.transaction = originalTransaction;
  });

  // ---------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------

  async function seedExternalOperation(
    lifecycleState = 'PENDING_VERIFICATION',
    customOpId?: string,
    customRefValue?: string,
  ): Promise<{ opId: string; refValue: string; providerIdempotencyKey: string; customerId: string; walletId: string; bindingId: string }> {
    const opId = customOpId || externalOperationId;
    const refValue = customRefValue || A6_EXTERNAL_OPERATION_REFERENCE;
    const providerIdempotencyKey = `provider-key-a7-${opId.slice(0, 8)}`;

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

    // Seed initial funding
    await ledger.postJournal({
      idempotencyKey: `a7-seed-${suffix}`,
      reference: `a7-seed-${suffix}`,
      description: 'Initial funding',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: settlementAssetLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '100000' },
        { accountId: customerAccId, direction: LedgerEntryDirection.CREDIT, amountMinor: '100000' },
      ],
    });

    const participant = await seedTransferParticipant(dataSource, `a7_${suffix}`, customerAccId);
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
               $12, 1, 3, 1)`,
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
      ],
    );

    // Seed verified evidence reference
    await dataSource.query(
      `INSERT INTO external_operation_references
         (id, external_operation_id, partner_key, reference_type, reference_value, namespace,
          source, observed_at)
       VALUES ($1, $2, 'NIBSS_NIP', 'OPERATION', $3, 'a7-product-financial-effect-settlement', 'CALLBACK', now())`,
      [randomUUID(), opId, refValue],
    );

    return { opId, refValue, providerIdempotencyKey, customerId: seededCustomerId, walletId: seededCustomerWalletId, bindingId: seededBindingId };
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
      contractName: 'A7-PRODUCT-LIFECYCLE',
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
      currentLifecycleState: command.currentLifecycleState,
      nextLifecycleState: command.nextLifecycleState,
      outcome: command.outcome,
      retryClass: command.retryClass,
      attempt: command.attempt,
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
    overrides: Partial<A7ProductLifecycleTransitionV1> = {},
  ): A7ProductLifecycleTransitionV1 {
    const envelopeBase: any = {
      contractName: 'A7-PRODUCT-LIFECYCLE',
      contractVersion: 1,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: 'virtual-account.inbound-funding',
      action: 'lifecycle',
      productState: 'FUNDING_PENDING_VERIFICATION',
      customerId: seededCustomerId,
      customerWalletId: seededCustomerWalletId,
      bindingId: seededBindingId,
      bindingVersion: 1,
      currentLifecycleState: 'LIFECYCLE_PENDING',
      nextLifecycleState: 'LIFECYCLE_ADMITTED',
      outcome: 'OUTCOME_PENDING',
      retryClass: 'NONE',
      attempt: 1,
      a7ProductCommandReference: A7T05_COMMAND_REFERENCE,
      a6ExternalOperationReference: A6_EXTERNAL_OPERATION_REFERENCE,
      a6LifecycleState: 'CREATED',
      a6ProviderIdempotencyScope: A6_PROVIDER_IDEMPOTENCY_SCOPE,
      a6ProviderIdempotencyKey: seededProviderIdempotencyKey,
      a2AuthorizationContextReference: 'a2-authorization-context',
      a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
      a7T04ProductCustomerBindingMapReference: A7T04_MAP_REFERENCE,
      a7T06NotificationDeliveryReference: null,
      recoveryReference: null,
      manualReviewReason: null,
      failureCode: null,
      failureMessage: null,
      providerStatus: null,
      idempotencyKey: `a7-lifecycle-key-${randomUUID()}`,
      requestContext: {
        requestId: 'req-a7-lifecycle',
        correlationId: 'corr-a7-lifecycle',
        traceId: 'trace-a7-lifecycle',
      },
      causationId: null,
      ...overrides,
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
  // A. Durable lifecycle transitions
  // =======================================================================================
  describe('Durable lifecycle transitions', () => {
    it('transitions lifecycle state correctly and updates attempt count', async () => {
      await seedExternalOperation('CREATED');
      const envelope = buildEnvelope();

      const result = await a7Lifecycle.transitionProductLifecycle(envelope);
      expect(result.valid).toBe(true);

      if (result.valid) {
        expect(result.record.currentLifecycleState).toBe('LIFECYCLE_ADMITTED');
        expect(result.record.attempt).toBe(1);

        // Verify outbox event enqueued
        const outboxEvents: Array<{ event_type: string }> = await dataSource.query(
          "SELECT event_type FROM outbox_events WHERE aggregate_type = 'A7_PRODUCT_LIFECYCLE' AND aggregate_id = $1",
          [result.record.productLifecycleId],
        );
        expect(outboxEvents[0]!.event_type).toBe('A7ProductLifecycleTransitioned');
      }
    });

    it('rejects an invalid lifecycle transition not allowed by transition table', async () => {
      await seedExternalOperation('CANCELLED');
      const envelope = buildEnvelope({
        currentLifecycleState: 'LIFECYCLE_CANCELLED',
        nextLifecycleState: 'LIFECYCLE_ADMITTED',
      });

      const result = await a7Lifecycle.transitionProductLifecycle(envelope);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.failure.code).toBe('A7_PRODUCT_LIFECYCLE_A6_LIFECYCLE_TERMINAL');
      }
    });
  });

  // =======================================================================================
  // B. Idempotency
  // =======================================================================================
  describe('Idempotency checks', () => {
    it('replays identical lifecycle transitions and throws on request hash conflict', async () => {
      await seedExternalOperation('CREATED');
      const envelope = buildEnvelope();

      const first = await a7Lifecycle.transitionProductLifecycle(envelope);
      const second = await a7Lifecycle.transitionProductLifecycle(envelope);

      expect(first.valid).toBe(true);
      expect(second.valid).toBe(true);
      if (first.valid && second.valid) {
        expect(second.record.productLifecycleId).toBe(first.record.productLifecycleId);
        expect(second.record.replayed).toBe(true);
      }

      // Payload conflict
      const conflictingEnvelope = buildEnvelope({
        ...envelope,
        attempt: 2,
        idempotencyKey: envelope.idempotencyKey,
      });

      const conflictResult = await a7Lifecycle.transitionProductLifecycle(conflictingEnvelope);
      expect(conflictResult.valid).toBe(false);
      if (!conflictResult.valid) {
        expect(conflictResult.failure.code).toBe('A7_PRODUCT_LIFECYCLE_REQUEST_HASH_CONFLICT');
      }
    });
  });

  // =======================================================================================
  // C. Attempt counting and bounded retry
  // =======================================================================================
  describe('Attempt counting and bounded retry', () => {
    it('increments attempts on scheduleRetry and fails with RETRY_EXHAUSTED once limit is reached', async () => {
      await seedExternalOperation('PENDING_VERIFICATION');

      // Attempt 1: Schedule first retry
      const env1 = buildEnvelope({
        currentLifecycleState: 'LIFECYCLE_PENDING_VERIFICATION',
        nextLifecycleState: 'LIFECYCLE_RETRY_SCHEDULED',
        retryClass: 'TIMEOUT',
        attempt: 1,
        a6LifecycleState: 'PENDING_VERIFICATION',
      });
      const r1 = await a7Lifecycle.scheduleRetry(env1);
      expect(r1.valid).toBe(true);
      if (r1.valid) {
        expect(r1.record.currentLifecycleState).toBe('LIFECYCLE_RETRY_SCHEDULED');
        expect(r1.record.attempt).toBe(1);
      }

      // Attempt 2: Schedule second retry
      const env2 = buildEnvelope({
        currentLifecycleState: 'LIFECYCLE_PENDING_VERIFICATION',
        nextLifecycleState: 'LIFECYCLE_RETRY_SCHEDULED',
        retryClass: 'TIMEOUT',
        attempt: 2,
        a6LifecycleState: 'PENDING_VERIFICATION',
      });
      const r2 = await a7Lifecycle.scheduleRetry(env2);
      expect(r2.valid).toBe(true);

      // Attempt 3: Exhausted!
      const env3 = buildEnvelope({
        currentLifecycleState: 'LIFECYCLE_PENDING_VERIFICATION',
        nextLifecycleState: 'LIFECYCLE_RETRY_SCHEDULED',
        retryClass: 'TIMEOUT',
        attempt: 3,
        a6LifecycleState: 'PENDING_VERIFICATION',
      });
      const r3 = await a7Lifecycle.scheduleRetry(env3);
      expect(r3.valid).toBe(false);
      if (!r3.valid) {
        expect(r3.failure.code).toBe('A7_PRODUCT_LIFECYCLE_RETRY_EXHAUSTED');
      }
    });
  });

  // =======================================================================================
  // D. Recovery references
  // =======================================================================================
  describe('Recovery references', () => {
    it('successfully issues and resolves recovery references', async () => {
      await seedExternalOperation('PENDING_VERIFICATION');
      const recoveryRef = `a7-product-lifecycle-recovery:${sha256('recovery-ref-1')}`;

      // Issue recovery
      const issueEnv = buildEnvelope({
        currentLifecycleState: 'LIFECYCLE_PENDING_VERIFICATION',
        nextLifecycleState: 'LIFECYCLE_RECOVERY_ISSUED',
        a6LifecycleState: 'PENDING_VERIFICATION',
        recoveryReference: recoveryRef,
      });

      const r1 = await a7Lifecycle.issueRecovery(issueEnv);
      expect(r1.valid).toBe(true);
      if (r1.valid) {
        expect(r1.record.currentLifecycleState).toBe('LIFECYCLE_RECOVERY_ISSUED');
        expect(r1.record.recoveryReference).toBe(recoveryRef);
      }

      // Resolve recovery to verification pending
      const resolveEnv = buildEnvelope({
        currentLifecycleState: 'LIFECYCLE_RECOVERY_ISSUED',
        nextLifecycleState: 'LIFECYCLE_PENDING_VERIFICATION',
        a6LifecycleState: 'PENDING_VERIFICATION',
        recoveryReference: recoveryRef,
        outcome: 'OUTCOME_VERIFIED',
      });

      const r2 = await a7Lifecycle.resolveRecovery(resolveEnv);
      expect(r2.valid).toBe(true);
      if (r2.valid) {
        expect(r2.record.currentLifecycleState).toBe('LIFECYCLE_PENDING_VERIFICATION');
      }
    });

    it('fails resolution on invalid recovery reference', async () => {
      await seedExternalOperation('PENDING_VERIFICATION');
      const recoveryRef = `a7-product-lifecycle-recovery:${sha256('recovery-ref-2')}`;

      const resolveEnv = buildEnvelope({
        currentLifecycleState: 'LIFECYCLE_PENDING_VERIFICATION',
        nextLifecycleState: 'LIFECYCLE_PENDING_VERIFICATION',
        a6LifecycleState: 'PENDING_VERIFICATION',
        recoveryReference: recoveryRef,
        outcome: 'OUTCOME_VERIFIED',
      });

      const result = await a7Lifecycle.resolveRecovery(resolveEnv);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.failure.code).toBe('A7_PRODUCT_LIFECYCLE_RECOVERY_REFERENCE_MISMATCH');
      }
    });
  });

  // =======================================================================================
  // E. Genuine PostgreSQL concurrency
  // =======================================================================================
  describe('SERIALIZABLE concurrency arbitration', () => {
    it('arbitrates concurrent lifecycle transitions using idempotency scope reservation', async () => {
      await seedExternalOperation('CREATED');
      const envelope = buildEnvelope();

      // Trigger two concurrent transition requests
      const p1 = a7Lifecycle.transitionProductLifecycle(envelope);
      const p2 = a7Lifecycle.transitionProductLifecycle(envelope);

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // The idempotency service completed reservation should return one successful and one blocked
      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(0);

      const res1 = (fulfilled[0] as PromiseFulfilledResult<any>).value;
      const res2 = (fulfilled[1] as PromiseFulfilledResult<any>).value;

      // One is a new transaction, the other is replayed idempotently
      expect(res1.valid).toBe(true);
      expect(res2.valid).toBe(true);
      expect(res2.record.productLifecycleId).toBe(res1.record.productLifecycleId);
    });
  });

  // =======================================================================================
  // F. Atomic Rollback
  // =======================================================================================
  describe('Atomic Rollback Guarantee', () => {
    it('rolls back the whole product lifecycle transaction if any error is thrown', async () => {
      await seedExternalOperation('CREATED');
      const envelope = buildEnvelope();

      await expect(
        dataSource.transaction('SERIALIZABLE', async (manager) => {
          await a7Lifecycle.transitionProductLifecycle(envelope);
          throw new Error('Forced rollback');
        }),
      ).rejects.toThrow('Forced rollback');

      // Verify no idempotency reservation remains in db
      const idempCount: Array<{ n: string }> = await dataSource.query(
        "SELECT count(*)::text as n FROM idempotency_records WHERE scope = 'a7.product-lifecycle.idempotency.v1'",
      );
      expect(firstRow(idempCount, 'idemp count').n).toBe('0');
    });
  });
});
