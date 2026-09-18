import { createHash } from 'node:crypto';

import { A7ProductLifecycleService } from '../src/policy/a7-product-lifecycle.service';
import type { A7ProductLifecycleRepository } from '../src/policy/a7-product-lifecycle.repository';
import type { A7ProductLifecycleTransitionV1 } from '../src/policy/a7-product-lifecycle.types';
import {
  A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
  A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
  A7_PRODUCT_LIFECYCLE_INTERNAL_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_LIFECYCLE_PROVIDER_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_MISSING,
  A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_DENIED,
  A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_STALE,
  A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_MISSING,
  A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
  A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_EXPIRED,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_TERMINAL,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_STALE,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_STATUS_VERIFICATION_UNAVAILABLE,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_CIRCUIT_OPEN,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_RETRY_EXHAUSTED,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_INVALID_TRANSITION,
  A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_NOT_FOUND,
  A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
  A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_MISSING,
  A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISSING,
  A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISMATCH,
  A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_EXHAUSTED,
  A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_CLASS_NOT_RETRYABLE,
  A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED,
  A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_STATE_INVALID,
  A7_PRODUCT_LIFECYCLE_FAILURE_REQUEST_HASH_CONFLICT,
  A7_PRODUCT_LIFECYCLE_FAILURE_IDEMPOTENCY_IN_PROGRESS,
  A7_PRODUCT_LIFECYCLE_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
  A7_PRODUCT_LIFECYCLE_FAILURE_OUTBOX_PUBLICATION_FAILED,
  A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_MANUAL_REVIEW_REQUIRED,
  A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_UNKNOWN,
  A7_PRODUCT_LIFECYCLE_HANDOFF_SCOPE,
  A7_PRODUCT_LIFECYCLE_MAX_RETRY_ATTEMPTS,
  A7_PRODUCT_LIFECYCLE_STATES,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_AMBIGUOUS_COMMIT,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_NONE,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_PARTNER_REJECTION,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_SAFE_TRANSPORT,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_TIMEOUT,
  A7_PRODUCT_LIFECYCLE_OUTCOMES,
  A7_PRODUCT_LIFECYCLE_STATE_ADMITTED,
  A7_PRODUCT_LIFECYCLE_STATE_CANCELLED,
  A7_PRODUCT_LIFECYCLE_STATE_FAILED,
  A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
  A7_PRODUCT_LIFECYCLE_STATE_PENDING,
  A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER,
  A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
  A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED,
  A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED,
} from '../src/policy/a7-product-lifecycle.constants';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const BINDING_ID = '00000000-0000-4000-8000-000000000003';
const A7T04_MAP_REFERENCE = createHash('sha256')
  .update('a7-product-customer-binding-v1')
  .digest('hex');
const A7T05_COMMAND_REFERENCE = 'a7-product-command:v1:abc';
const A6_EXTERNAL_OPERATION_REFERENCE = 'external-operation:v1:abc';
const A6_PROVIDER_IDEMPOTENCY_SCOPE = 'nibss.nip.external-operation.v1';
const A6_PROVIDER_IDEMPOTENCY_KEY = 'nibss.nip.external-operation.v1:abc';
const RECOVERY_REFERENCE = `a7-product-lifecycle-recovery:${createHash('sha256').update('recovery-1').digest('hex')}`;
const REQUEST_ID = 'request-a7t07-1';
const CORRELATION_ID = 'correlation-a7t07-1';
const TRACE_ID = 'trace-a7t07-1';

function makeTransitionInput(
  overrides: Record<string, unknown> = {},
): A7ProductLifecycleTransitionV1 {
  return {
    contractName: A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
    contractVersion: A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
    productKey: 'VIRTUAL_ACCOUNT',
    productVersion: 1,
    capabilityKey: 'virtual-account.assign',
    action: 'assign',
    productState: 'ASSIGN_REQUESTED',
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    bindingId: BINDING_ID,
    bindingVersion: 1,
    currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING,
    nextLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_ADMITTED,
    outcome: 'OUTCOME_PENDING',
    retryClass: 'NONE',
    attempt: 1,
    a7ProductCommandReference: A7T05_COMMAND_REFERENCE,
    a6ExternalOperationReference: A6_EXTERNAL_OPERATION_REFERENCE,
    a6LifecycleState: 'CREATED',
    a6ProviderIdempotencyScope: A6_PROVIDER_IDEMPOTENCY_SCOPE,
    a6ProviderIdempotencyKey: A6_PROVIDER_IDEMPOTENCY_KEY,
    a2AuthorizationContextReference: 'a2-authorization-context',
    a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
    a7T04ProductCustomerBindingMapReference: A7T04_MAP_REFERENCE,
    a7T06NotificationDeliveryReference: null,
    recoveryReference: null,
    manualReviewReason: null,
    failureCode: null,
    failureMessage: null,
    providerStatus: null,
    idempotencyKey: 'a7-product-lifecycle-key-1',
    requestHash: createHash('sha256').update('placeholder').digest('hex'),
    requestContext: {
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      traceId: TRACE_ID,
    },
    causationId: null,
    ...(overrides as Partial<A7ProductLifecycleTransitionV1>),
  } as A7ProductLifecycleTransitionV1;
}

class FakeRepository {
  readonly providers: ReturnType<A7ProductLifecycleRepository['getConsumerPorts']>;
  private readonly idempotencyRecords = new Map<
    string,
    { id: string; responseBody: Record<string, unknown> | null }
  >();
  private auditCalls: Array<{ action: string; entityId: string }> = [];
  private outboxCalls: Array<{ eventType: string; aggregateId: string }> = [];
  private metricsCalls: Array<string> = [];
  public a6LifecycleStateOverride: string | null = null;
  public a6Lifecycle: unknown = {
    externalOperationId: A6_EXTERNAL_OPERATION_REFERENCE,
    externalOperationReference: A6_EXTERNAL_OPERATION_REFERENCE,
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    lifecycleState: 'CREATED',
    attemptCount: 1,
    maxAttempts: 3,
    providerStatus: null,
    providerIdempotencyScope: A6_PROVIDER_IDEMPOTENCY_SCOPE,
    providerIdempotencyKey: A6_PROVIDER_IDEMPOTENCY_KEY,
    replayed: false,
  };
  public a6StatusState:
    | 'VERIFIED_PENDING'
    | 'VERIFIED_REJECTED'
    | 'VERIFIED_ACCEPTED_NOT_SETTLED'
    | 'UNKNOWN'
    | 'UNAVAILABLE' = 'VERIFIED_PENDING';
  public a6CircuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  public a2Response: unknown = {
    principalType: 'SERVICE',
    principalId: 'a7-product-lifecycle',
    customerId: null,
    customerAccess: 'ANY',
    evaluatedAt: new Date().toISOString(),
    allowed: true,
    action: 'a7-product-lifecycle',
    resourceType: 'A7_PRODUCT_LIFECYCLE',
    resourceId: null,
  };
  public a3Response: unknown = {
    bindingId: BINDING_ID,
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    walletAccountId: BINDING_ID,
    ledgerAccountId: BINDING_ID,
    bindingVersion: 1,
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
  };
  public a4Response: unknown = {
    decisionReference: 'a4-product-policy-decision',
    productKey: 'VIRTUAL_ACCOUNT',
    capability: 'product.virtual-account',
    action: 'lifecycle',
    profileReference: 'profile.product-virtual-account-lifecycle.v1',
    policyVersion: 'a4.profile.product-virtual-account-lifecycle.v1',
    decision: 'ALLOW_WITH_LIMITS',
    expiresAt: null,
    reasonCodes: [],
    maxAmountMinor: null,
  };
  public a7T04Response: unknown = {
    mapReference: A7T04_MAP_REFERENCE,
    productKey: 'VIRTUAL_ACCOUNT',
    productVersion: 1,
    capabilityKey: 'virtual-account.assign',
    action: 'assign',
    productState: 'ASSIGN_REQUESTED',
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    bindingId: BINDING_ID,
    bindingVersion: 1,
    a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
    a2AuthorizationContextReference: 'a2-authorization-context',
  };
  public a7T05Response: unknown = {
    productCommandReference: A7T05_COMMAND_REFERENCE,
    productOperationReference: A7T05_COMMAND_REFERENCE,
    productKey: 'VIRTUAL_ACCOUNT',
    productVersion: 1,
    capabilityKey: 'virtual-account.assign',
    action: 'assign',
    productState: 'ASSIGN_REQUESTED',
    operationState: 'COMMAND_ADMITTED',
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    bindingId: BINDING_ID,
    bindingVersion: 1,
  };
  public a7T06Response: unknown = {
    notificationDispatchReference: 'a7-notification-dispatch:v1:abc',
    deliveryState: 'DISPATCHED',
    notificationChannel: 'email',
    customerPreferenceReference: 'customer-preference-reference',
  };
  public idempotencyKind: 'NEW' | 'REPLAY' | 'IN_PROGRESS' = 'NEW';
  public throwOnReserve: Error | null = null;
  public throwOnComplete: Error | null = null;
  public throwOnAudit: Error | null = null;
  public throwOnOutbox: Error | null = null;
  private reservationCounter = 0;

  constructor() {
    const providers = {
      a6LifecycleLookup: () => {
        if (this.a6LifecycleStateOverride) {
          return Promise.resolve({
            ...(this.a6Lifecycle as Record<string, unknown>),
            lifecycleState: this.a6LifecycleStateOverride,
          });
        }
        return Promise.resolve(this.a6Lifecycle);
      },
      a6StatusVerification: () =>
        Promise.resolve({
          state: this.a6StatusState,
          providerStatus: null,
          providerReferenceHash: null,
          observedAt: new Date().toISOString(),
          reasonCode: null,
        }),
      a6CircuitBreaker: () =>
        Promise.resolve({
          partnerKey: 'NIBSS_NIP',
          capabilityKey: 'external.wallet.withdrawal.settlement',
          state: this.a6CircuitState,
          openedAt: null,
          cooldownSeconds: 0,
          reasonCode: null,
        }),
      a2AuthorizationContextLookup: () => Promise.resolve(this.a2Response),
      a3BindingRecheck: () => Promise.resolve(this.a3Response),
      a4ProductPolicyDecisionLookup: () => Promise.resolve(this.a4Response),
      a7T05ProductCommandLookup: () => Promise.resolve(this.a7T05Response),
      a7T04ProductCustomerBindingMapReferenceCheck: () => Promise.resolve(this.a7T04Response),
      a7T06NotificationDeliveryLookup: () => Promise.resolve(this.a7T06Response),
      operationsIdempotencyReserve: (
        _manager: unknown,
        command: { readonly key: string; readonly requestHash: string },
      ) => {
        if (this.throwOnReserve) {
          return Promise.reject(this.throwOnReserve);
        }
        const lookupKey = `${command.key}:${command.requestHash}`;
        const existing = this.idempotencyRecords.get(lookupKey);
        if (existing) {
          return Promise.resolve({
            kind: 'REPLAY' as const,
            record: { id: existing.id, resourceId: null, responseBody: existing.responseBody },
          });
        }
        if (this.idempotencyKind === 'IN_PROGRESS') {
          return Promise.resolve({
            kind: 'IN_PROGRESS' as const,
            record: { id: 'in-progress', resourceId: null, responseBody: null },
          });
        }
        const recordId = `idempotency-${++this.reservationCounter}`;
        this.idempotencyRecords.set(lookupKey, { id: recordId, responseBody: null });
        return Promise.resolve({
          kind: 'NEW' as const,
          record: { id: recordId, resourceId: null, responseBody: null },
        });
      },
      operationsIdempotencyComplete: (
        _manager: unknown,
        recordId: string,
        command: {
          readonly responseBody?: Readonly<Record<string, unknown>>;
          readonly key?: string;
          readonly requestHash?: string;
        },
      ) => {
        if (this.throwOnComplete) {
          return Promise.reject(this.throwOnComplete);
        }
        if (command.key && command.requestHash && command.responseBody) {
          const lookupKey = `${command.key}:${command.requestHash}`;
          this.idempotencyRecords.set(lookupKey, {
            id: recordId,
            responseBody: { ...command.responseBody },
          });
        }
        return Promise.resolve();
      },
      operationsIdempotencyFail: () => Promise.resolve(),
      operationsAudit: (
        _manager: unknown,
        record: { readonly action: string; readonly entityId: string },
      ) => {
        if (this.throwOnAudit) {
          return Promise.reject(this.throwOnAudit);
        }
        this.auditCalls.push({ action: record.action, entityId: record.entityId });
        return Promise.resolve();
      },
      operationsOutboxEnqueue: (
        _manager: unknown,
        command: { readonly eventType: string; readonly aggregateId: string },
      ) => {
        if (this.throwOnOutbox) {
          return Promise.reject(this.throwOnOutbox);
        }
        this.outboxCalls.push({
          eventType: command.eventType,
          aggregateId: command.aggregateId,
        });
        return Promise.resolve();
      },
      operationsMetricsIncrement: (_manager: unknown, metricName: string) => {
        this.metricsCalls.push(metricName);
        return Promise.resolve();
      },
      operationsDiagnosticsReport: () => Promise.resolve(),
    };
    this.providers = providers as never;
  }

  getConsumerPorts(): never {
    return this.providers as never;
  }

  getA7ProductLifecycleProviderIdempotencyScope(): string {
    return A7_PRODUCT_LIFECYCLE_PROVIDER_IDEMPOTENCY_SCOPE;
  }

  getDataSource(): unknown {
    return {
      transaction: async (
        _isolationOrRunner: unknown,
        runner?: (manager: unknown) => Promise<unknown>,
      ) => {
        if (typeof runner === 'function') {
          return runner({});
        }
        if (typeof _isolationOrRunner === 'function') {
          return (_isolationOrRunner as (manager: unknown) => Promise<unknown>)({});
        }
        return {};
      },
    };
  }

  getAuditCalls(): ReadonlyArray<{ action: string; entityId: string }> {
    return this.auditCalls;
  }

  getOutboxCalls(): ReadonlyArray<{ eventType: string; aggregateId: string }> {
    return this.outboxCalls;
  }

  getMetricsCalls(): readonly string[] {
    return this.metricsCalls;
  }
}

function makeService(): {
  service: A7ProductLifecycleService;
  repository: FakeRepository;
} {
  const repository = new FakeRepository();
  const service = new A7ProductLifecycleService(
    repository as unknown as A7ProductLifecycleRepository,
  );
  return { service, repository };
}

function buildCanonicalHashInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractName: A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
    contractVersion: 1,
    productKey: 'VIRTUAL_ACCOUNT',
    productVersion: 1,
    capabilityKey: 'virtual-account.assign',
    action: 'assign',
    productState: 'ASSIGN_REQUESTED',
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    bindingId: BINDING_ID,
    bindingVersion: 1,
    currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING,
    nextLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_ADMITTED,
    outcome: 'OUTCOME_PENDING',
    retryClass: 'NONE',
    attempt: 1,
    a7ProductCommandReference: A7T05_COMMAND_REFERENCE,
    a6ExternalOperationReference: A6_EXTERNAL_OPERATION_REFERENCE,
    a6LifecycleState: 'CREATED',
    recoveryReference: null,
    correlationId: CORRELATION_ID,
    causationId: null,
    ...overrides,
  };
}

function withHash(
  service: A7ProductLifecycleService,
  command: A7ProductLifecycleTransitionV1,
): A7ProductLifecycleTransitionV1 {
  return {
    ...command,
    requestHash: service.deriveRequestHash(
      buildCanonicalHashInput({
        bindingVersion: command.bindingVersion,
        currentLifecycleState: command.currentLifecycleState,
        nextLifecycleState: command.nextLifecycleState,
        attempt: command.attempt,
        outcome: command.outcome,
        retryClass: command.retryClass,
        a6LifecycleState: command.a6LifecycleState,
        recoveryReference: command.recoveryReference,
      }) as never,
    ),
  };
}

describe('A7ProductLifecycleService (A7T07)', () => {
  it('exposes the A7 product lifecycle contract name, version, and idempotency scopes', () => {
    const { service } = makeService();
    expect(service.getContractNames()).toEqual({
      a2: 'A2-PROTECTED-ROUTE-AUTHORIZATION',
      a3: 'A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING',
      a4: 'A4-CAPABILITY-POLICY',
      a6: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6T07: 'A6-EXTERNAL-LIFECYCLE',
      a6CircuitBreaker: 'A6-PARTNER-CIRCUIT-BREAKER',
      a6T05: 'A6-EXTERNAL-OPERATION',
      a7T04: 'A7-PRODUCT-CUSTOMER-BINDING',
      a7T05: 'A7-PRODUCT-COMMAND',
      a7T06: 'A7-NOTIFICATION-DELIVERY',
      a7: 'A7-PRODUCT-LIFECYCLE',
    });
    expect(service.getContractVersions()).toEqual({
      a2: 1,
      a3: 1,
      a4: 1,
      a6: 1,
      a6T07: 1,
      a6CircuitBreaker: 1,
      a6T05: 1,
      a7T04: 1,
      a7T05: 1,
      a7T06: 1,
      a7: 1,
    });
    expect(service.getInternalIdempotencyScope()).toBe(
      A7_PRODUCT_LIFECYCLE_INTERNAL_IDEMPOTENCY_SCOPE,
    );
    expect(service.getProviderIdempotencyScope()).toBe(
      A7_PRODUCT_LIFECYCLE_PROVIDER_IDEMPOTENCY_SCOPE,
    );
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getAuditEntityType()).toBe('A7_PRODUCT_LIFECYCLE');
    expect(service.getAuditActor()).toBe('a7-product-lifecycle');
    expect(service.getMaxRetryAttempts()).toBe(A7_PRODUCT_LIFECYCLE_MAX_RETRY_ATTEMPTS);
  });

  it('exposes the A7 product lifecycle state, retry class, and outcome vocabularies', () => {
    const { service } = makeService();
    expect(service.listLifecycleStates()).toEqual(A7_PRODUCT_LIFECYCLE_STATES);
    expect(service.listTerminalStates()).toEqual([
      A7_PRODUCT_LIFECYCLE_STATE_FAILED,
      A7_PRODUCT_LIFECYCLE_STATE_CANCELLED,
    ]);
    expect(service.listRetryClasses()).toContain(A7_PRODUCT_LIFECYCLE_RETRY_CLASS_NONE);
    expect(service.listOutcomes()).toEqual(A7_PRODUCT_LIFECYCLE_OUTCOMES);
  });

  it('exposes the A6 lifecycle mapping for the A7 product lifecycle states', () => {
    const { service } = makeService();
    const mapping = service.getA6LifecycleMapping();
    expect(mapping[A7_PRODUCT_LIFECYCLE_STATE_PENDING]).toBe('CREATED');
    expect(mapping[A7_PRODUCT_LIFECYCLE_STATE_ADMITTED]).toBe('SUBMITTING');
    expect(mapping[A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER]).toBe('PENDING_PROVIDER');
    expect(mapping[A7_PRODUCT_LIFECYCLE_STATE_FAILED]).toBe('FAILED');
  });

  it('rejects commands with an invalid contract name', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ contractName: 'OTHER' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid contract version', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ contractVersion: 99 as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid product key', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ productKey: 'OTHER' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid capability key', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ capabilityKey: 'unknown.capability' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid action', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ action: 'unknown' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid product state', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ productState: 'UNKNOWN_STATE' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_STATE_INVALID);
    }
  });

  it('rejects commands with an invalid current lifecycle state', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ currentLifecycleState: 'NOT_A_STATE' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid next lifecycle state', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ nextLifecycleState: 'NOT_A_STATE' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid outcome', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ outcome: 'OUTCOME_INVALID' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_UNKNOWN);
    }
  });

  it('rejects commands with an invalid retry class', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ retryClass: 'NOT_A_CLASS' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_CLASS_NOT_RETRYABLE);
    }
  });

  it('rejects commands with a non-positive attempt', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(makeTransitionInput({ attempt: 0 }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with a non-UUID customerId', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ customerId: 'not-a-uuid' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
      );
    }
  });

  it('rejects commands with an invalid a6LifecycleState', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ a6LifecycleState: 'NOT_A_STATE' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING);
    }
  });

  it('rejects commands with an invalid a7T04 product customer-binding map reference', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ a7T04ProductCustomerBindingMapReference: 'not-a-sha256' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
      );
    }
  });

  it('rejects commands with an invalid recovery reference', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ recoveryReference: 'invalid-recovery' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISSING);
    }
  });

  it('rejects commands with an invalid request hash', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({ requestHash: 'not-a-sha256-hash' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_REQUEST_HASH_CONFLICT);
    }
  });

  it('fails closed when the A6 lifecycle record is missing', async () => {
    const { service, repository } = makeService();
    repository.a6Lifecycle = null;
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING);
    }
  });

  it('fails closed when the A6 lifecycle state is terminal', async () => {
    const { service, repository } = makeService();
    repository.a6Lifecycle = {
      ...(repository.a6Lifecycle as Record<string, unknown>),
      lifecycleState: 'FAILED',
    };
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_TERMINAL);
    }
  });

  it('fails closed when the A6 lifecycle state is stale', async () => {
    const { service, repository } = makeService();
    repository.a6Lifecycle = {
      ...(repository.a6Lifecycle as Record<string, unknown>),
      lifecycleState: 'SUBMITTING',
    };
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_STALE);
    }
  });

  it('fails closed when the A6 retry attempts are exhausted', async () => {
    const { service, repository } = makeService();
    repository.a6Lifecycle = {
      ...(repository.a6Lifecycle as Record<string, unknown>),
      attemptCount: 4,
      maxAttempts: 3,
    };
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A6_RETRY_EXHAUSTED);
    }
  });

  it('fails closed when the A6 status verification is unavailable', async () => {
    const { service, repository } = makeService();
    repository.a6StatusState = 'UNAVAILABLE';
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_LIFECYCLE_FAILURE_A6_STATUS_VERIFICATION_UNAVAILABLE,
      );
    }
  });

  it('fails closed when the A6 partner circuit-breaker is OPEN', async () => {
    const { service, repository } = makeService();
    repository.a6CircuitState = 'OPEN';
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A6_CIRCUIT_OPEN);
    }
  });

  it('fails closed when the A2 authorization context is missing', async () => {
    const { service, repository } = makeService();
    repository.a2Response = null;
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_MISSING);
    }
  });

  it('fails closed when the A2 authorization context is stale', async () => {
    const { service, repository } = makeService();
    repository.a2Response = {
      ...(repository.a2Response as Record<string, unknown>),
      evaluatedAt: new Date(0).toISOString(),
    };
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_STALE);
    }
  });

  it('fails closed when the A2 authorization context is denied', async () => {
    const { service, repository } = makeService();
    repository.a2Response = {
      ...(repository.a2Response as Record<string, unknown>),
      allowed: false,
    };
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_DENIED);
    }
  });

  it('fails closed when the A4 product-policy decision is missing', async () => {
    const { service, repository } = makeService();
    repository.a4Response = null;
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_MISSING);
    }
  });

  it('fails closed when the A4 product-policy decision is not executable', async () => {
    const { service, repository } = makeService();
    repository.a4Response = {
      ...(repository.a4Response as Record<string, unknown>),
      decision: 'DENY',
    };
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
      );
    }
  });

  it('fails closed when the A4 product-policy decision is expired', async () => {
    const { service, repository } = makeService();
    repository.a4Response = {
      ...(repository.a4Response as Record<string, unknown>),
      expiresAt: new Date(0).toISOString(),
    };
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_EXPIRED);
    }
  });

  it('fails closed when the A7T05 product command/operation reference is missing', async () => {
    const { service, repository } = makeService();
    repository.a7T05Response = null;
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_NOT_FOUND,
      );
    }
  });

  it('fails closed when the A7T05 product command/operation context does not match', async () => {
    const { service, repository } = makeService();
    repository.a7T05Response = {
      ...(repository.a7T05Response as Record<string, unknown>),
      customerId: '00000000-0000-4000-8000-000000000099',
    };
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
      );
    }
  });

  it('fails closed when the A7T06 product notification delivery handoff is missing', async () => {
    const { service, repository } = makeService();
    repository.a7T06Response = null;
    const result = await service.transitionProductLifecycle(
      withHash(
        service,
        makeTransitionInput({ a7T06NotificationDeliveryReference: 'a7-notification:v1:abc' }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_MISSING);
    }
  });

  it('fails closed on an invalid lifecycle state transition', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING,
          nextLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED,
        }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_INVALID_TRANSITION,
      );
    }
  });

  it('fails closed on a terminal current lifecycle state', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_FAILED,
          nextLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_ADMITTED,
        }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_INVALID_TRANSITION,
      );
    }
  });

  it('fails closed when the request hash does not match the canonical hash', async () => {
    const { service } = makeService();
    const result = await service.transitionProductLifecycle(
      makeTransitionInput({
        requestHash: createHash('sha256').update('a-different-hash').digest('hex'),
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_REQUEST_HASH_CONFLICT);
    }
  });

  it('fails closed when the A7 internal idempotency reservation is in progress', async () => {
    const { service, repository } = makeService();
    repository.idempotencyKind = 'IN_PROGRESS';
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_IDEMPOTENCY_IN_PROGRESS);
    }
  });

  it('admits a valid A7 product lifecycle transition and records the audit and outbox facts', async () => {
    const { service, repository } = makeService();
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.reservation.kind).toBe('NEW');
      expect(result.record.productKey).toBe('VIRTUAL_ACCOUNT');
      expect(result.record.currentLifecycleState).toBe(A7_PRODUCT_LIFECYCLE_STATE_ADMITTED);
      expect(result.record.idempotencyScope).toBe('a7.product-lifecycle.idempotency.v1');
      expect(result.record.requestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.handoff.handoffScope).toBe(A7_PRODUCT_LIFECYCLE_HANDOFF_SCOPE);
      expect(result.handoff.productLifecycleId).toBe(result.record.productLifecycleId);
    }
    const auditActions = repository.getAuditCalls().map((call) => call.action);
    expect(auditActions).toContain('A7_PRODUCT_LIFECYCLE_ADMITTED');
    expect(auditActions).toContain('A7_PRODUCT_LIFECYCLE_RESERVED');
    const outboxCalls = repository.getOutboxCalls();
    expect(outboxCalls.length).toBeGreaterThanOrEqual(1);
    expect(outboxCalls[0]?.eventType).toBe('A7ProductLifecycleTransitioned');
    const metricsCalls = repository.getMetricsCalls();
    expect(metricsCalls).toContain('a7.product-lifecycle.admitted');
    expect(metricsCalls).toContain('a7.product-lifecycle.transitioned');
  });

  it('returns the durable replayed A7 product lifecycle record for the same scope/key with the same hash', async () => {
    const { service } = makeService();
    const first = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(first.valid).toBe(true);
    const second = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(second.valid).toBe(true);
    if (first.valid && second.valid) {
      expect(second.reservation.kind).toBe('REPLAY');
      expect(second.record.productLifecycleId).toBe(first.record.productLifecycleId);
      expect(second.record.replayed).toBe(true);
    }
  });

  it('schedules a bounded retry and increments the retry metric', async () => {
    const { service, repository } = makeService();
    repository.a6LifecycleStateOverride = 'PENDING_PROVIDER';
    const result = await service.scheduleRetry(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER,
          a6LifecycleState: 'PENDING_PROVIDER',
          nextLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED,
          outcome: 'OUTCOME_PENDING',
          retryClass: A7_PRODUCT_LIFECYCLE_RETRY_CLASS_SAFE_TRANSPORT,
        }),
      ),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record.currentLifecycleState).toBe(A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED);
    }
    expect(repository.getMetricsCalls()).toContain('a7.product-lifecycle.retry-scheduled');
  });

  it('fails closed on a non-retryable retry class (NONE)', async () => {
    const { service, repository } = makeService();
    repository.a6LifecycleStateOverride = 'PENDING_PROVIDER';
    const result = await service.scheduleRetry(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER,
          a6LifecycleState: 'PENDING_PROVIDER',
          retryClass: A7_PRODUCT_LIFECYCLE_RETRY_CLASS_NONE,
        }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_EXHAUSTED);
    }
  });

  it('fails closed on a non-retryable retry class (PARTNER_REJECTION)', async () => {
    const { service, repository } = makeService();
    repository.a6LifecycleStateOverride = 'PENDING_PROVIDER';
    const result = await service.scheduleRetry(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER,
          a6LifecycleState: 'PENDING_PROVIDER',
          retryClass: A7_PRODUCT_LIFECYCLE_RETRY_CLASS_PARTNER_REJECTION,
        }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_EXHAUSTED);
    }
  });

  it('fails closed on an ambiguous commit retry class (must be resolved through recovery, not blind retry)', async () => {
    const { service, repository } = makeService();
    repository.a6LifecycleStateOverride = 'PENDING_PROVIDER';
    const result = await service.scheduleRetry(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER,
          a6LifecycleState: 'PENDING_PROVIDER',
          retryClass: A7_PRODUCT_LIFECYCLE_RETRY_CLASS_AMBIGUOUS_COMMIT,
        }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_EXHAUSTED);
    }
  });

  it('fails closed on retry exhaustion (attempt >= maxAttempts)', async () => {
    const { service, repository } = makeService();
    repository.a6LifecycleStateOverride = 'PENDING_PROVIDER';
    const result = await service.scheduleRetry(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER,
          a6LifecycleState: 'PENDING_PROVIDER',
          retryClass: A7_PRODUCT_LIFECYCLE_RETRY_CLASS_TIMEOUT,
          attempt: A7_PRODUCT_LIFECYCLE_MAX_RETRY_ATTEMPTS,
        }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_EXHAUSTED);
    }
  });

  it('issues a recovery reference and increments the recovery-issued metric', async () => {
    const { service, repository } = makeService();
    const result = await service.issueRecovery(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
          recoveryReference: RECOVERY_REFERENCE,
        }),
      ),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record.currentLifecycleState).toBe(A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED);
      expect(result.record.recoveryReference).toBe(RECOVERY_REFERENCE);
    }
    expect(repository.getMetricsCalls()).toContain('a7.product-lifecycle.recovery-issued');
  });

  it('fails closed on a missing recovery reference', async () => {
    const { service } = makeService();
    const result = await service.issueRecovery(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
          recoveryReference: null,
        }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISSING);
    }
  });

  it('resolves a recovery reference and transitions to PENDING_VERIFICATION on verified outcome', async () => {
    const { service, repository } = makeService();
    const result = await service.resolveRecovery(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED,
          recoveryReference: RECOVERY_REFERENCE,
          outcome: 'OUTCOME_VERIFIED',
        }),
      ),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record.currentLifecycleState).toBe(
        A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
      );
    }
    expect(repository.getMetricsCalls()).toContain('a7.product-lifecycle.recovery-resolved');
  });

  it('fails closed on a recovery resolution from a non-RECOVERY_ISSUED state (recovery-reference mismatch)', async () => {
    const { service } = makeService();
    const result = await service.resolveRecovery(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
          recoveryReference: RECOVERY_REFERENCE,
          outcome: 'OUTCOME_VERIFIED',
        }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISMATCH);
    }
  });

  it('places the A7 product lifecycle in MANUAL_REVIEW and increments the manual-review metric', async () => {
    const { service, repository } = makeService();
    const result = await service.placeUnderManualReview(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
          nextLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
          manualReviewReason: 'A7 product lifecycle requires manual review',
        }),
      ),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record.currentLifecycleState).toBe(A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW);
    }
    expect(repository.getMetricsCalls()).toContain('a7.product-lifecycle.manual-review');
  });

  it('fails closed on a missing manual review reason', async () => {
    const { service } = makeService();
    const result = await service.placeUnderManualReview(
      withHash(
        service,
        makeTransitionInput({
          currentLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
          nextLifecycleState: A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
          manualReviewReason: null,
        }),
      ),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_MANUAL_REVIEW_REQUIRED);
    }
  });

  it('fails closed when the Operations audit evidence is unavailable', async () => {
    const { service, repository } = makeService();
    repository.throwOnAudit = new Error('audit unavailable');
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_LIFECYCLE_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
      );
    }
  });

  it('fails closed when the Operations outbox evidence is unavailable', async () => {
    const { service, repository } = makeService();
    repository.throwOnOutbox = new Error('outbox unavailable');
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_LIFECYCLE_FAILURE_OUTBOX_PUBLICATION_FAILED);
    }
  });

  it('derives the canonical A7 product lifecycle request hash deterministically', () => {
    const { service } = makeService();
    const input = buildCanonicalHashInput();
    const first = service.deriveRequestHash(input as never);
    const second = service.deriveRequestHash(input as never);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    const different = service.deriveRequestHash({
      ...input,
      attempt: 2,
    } as never);
    expect(different).not.toBe(first);
  });

  it('computes a deterministic recovery reference for a given product lifecycle id', () => {
    const { service } = makeService();
    const first = service.computeRecoveryReference('product-lifecycle-id-1');
    const second = service.computeRecoveryReference('product-lifecycle-id-1');
    // Two different randomUUID calls produce different references.
    expect(first).toMatch(/^a7-product-lifecycle-recovery:[a-f0-9]{64}$/);
    expect(second).toMatch(/^a7-product-lifecycle-recovery:[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });

  it('asserts a permitted lifecycle transition and rejects a terminal-from transition', () => {
    const { service } = makeService();
    const permitted = service.assertLifecycleTransition(
      A7_PRODUCT_LIFECYCLE_STATE_PENDING,
      A7_PRODUCT_LIFECYCLE_STATE_ADMITTED,
    );
    expect(permitted.ok).toBe(true);
    const denied = service.assertLifecycleTransition(
      A7_PRODUCT_LIFECYCLE_STATE_FAILED,
      A7_PRODUCT_LIFECYCLE_STATE_ADMITTED,
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toContain('terminal');
    }
  });

  it('asserts a retryable retry class and rejects a non-retryable retry class', () => {
    const { service } = makeService();
    const retryable = service.assertRetryable(A7_PRODUCT_LIFECYCLE_RETRY_CLASS_SAFE_TRANSPORT, 1);
    expect(retryable.ok).toBe(true);
    const nonRetryable = service.assertRetryable(A7_PRODUCT_LIFECYCLE_RETRY_CLASS_NONE, 1);
    expect(nonRetryable.ok).toBe(false);
  });

  it('returns the A7 product lifecycle handoff with the canonical fields', async () => {
    const { service, repository } = makeService();
    const result = await service.transitionProductLifecycle(
      withHash(service, makeTransitionInput()),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      const handoff = service.getProductLifecycleHandoff(result.record);
      expect(handoff.handoffScope).toBe(A7_PRODUCT_LIFECYCLE_HANDOFF_SCOPE);
      expect(handoff.productLifecycleId).toBe(result.record.productLifecycleId);
      expect(handoff.a7ProductCommandReference).toBe(A7T05_COMMAND_REFERENCE);
      expect(handoff.a6ExternalOperationReference).toBe(A6_EXTERNAL_OPERATION_REFERENCE);
    }
    void repository;
  });

  it('exposes the A7 product lifecycle metric names', () => {
    const { service } = makeService();
    const names = service.listMetricNames();
    expect(names).toContain('a7.product-lifecycle.admitted');
    expect(names).toContain('a7.product-lifecycle.transitioned');
    expect(names).toContain('a7.product-lifecycle.retry-scheduled');
    expect(names).toContain('a7.product-lifecycle.recovery-issued');
    expect(names).toContain('a7.product-lifecycle.recovery-resolved');
    expect(names).toContain('a7.product-lifecycle.manual-review');
    expect(names).toContain('a7.product-lifecycle.failed');
    expect(names).toContain('a7.product-lifecycle.replayed');
  });

  it('exposes the A7 product lifecycle transition table', () => {
    const { service } = makeService();
    const table = service.listTransitionTable();
    expect(table[A7_PRODUCT_LIFECYCLE_STATE_PENDING]).toContain(
      A7_PRODUCT_LIFECYCLE_STATE_ADMITTED,
    );
    expect(table[A7_PRODUCT_LIFECYCLE_STATE_FAILED]).toEqual([]);
  });
});
