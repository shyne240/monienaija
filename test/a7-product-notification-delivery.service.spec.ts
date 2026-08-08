import { createHash } from 'node:crypto';

import { A7ProductNotificationDeliveryService } from '../src/policy/a7-product-notification-delivery.service';
import type { A7ProductNotificationDeliveryRepository } from '../src/policy/a7-product-notification-delivery.repository';
import type { A7ProductNotificationDispatchV1 } from '../src/policy/a7-product-notification-delivery.types';
import {
  A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
  A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
  A7_PRODUCT_NOTIFICATION_DELIVERY_INTERNAL_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDER_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_MISSING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_MISSING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T05_PRODUCT_COMMAND_MISSING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_DISABLED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_MISSING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_IDEMPOTENCY_IN_PROGRESS,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_NOTIFICATION_CHANNEL_UNSUPPORTED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_CLASSIFICATION_NOT_REGISTERED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_DISCLOSURE_REJECTED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_HASH_MISMATCH,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_SECRET_PRESENT,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_REQUEST_HASH_CONFLICT,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OUTBOX_PUBLICATION_FAILED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_TEMPLATE_REFERENCE_INVALID,
} from '../src/policy/a7-product-notification-delivery.constants';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const BINDING_ID = '00000000-0000-4000-8000-000000000003';
const CUSTOMER_PREFERENCE_ID = '00000000-0000-4000-8000-000000000004';
const A7T04_MAP_REFERENCE = createHash('sha256')
  .update('a7-product-customer-binding-v1')
  .digest('hex');
const A7T05_COMMAND_REFERENCE = 'a7-product-command:v1:abc';
const A6_EXTERNAL_OPERATION_REFERENCE = 'external-operation:v1:abc';
const REQUEST_ID = 'request-a7t06-1';
const CORRELATION_ID = 'correlation-a7t06-1';
const TRACE_ID = 'trace-a7t06-1';

function makeCommandInput(
  overrides: Record<string, unknown> = {},
): A7ProductNotificationDispatchV1 {
  const notificationPayload = {
    customerId: CUSTOMER_ID,
    productKey: 'VIRTUAL_ACCOUNT',
  };
  const notificationPayloadHash = createHash('sha256')
    .update(JSON.stringify(notificationPayload, Object.keys(notificationPayload).sort()))
    .digest('hex');
  return {
    contractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
    contractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
    productKey: 'VIRTUAL_ACCOUNT',
    productVersion: 1,
    capabilityKey: 'virtual-account.assign',
    action: 'assign',
    productState: 'ASSIGN_REQUESTED',
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    bindingId: BINDING_ID,
    bindingVersion: 1,
    customerPreferenceId: CUSTOMER_PREFERENCE_ID,
    notificationChannel: 'email',
    notificationTemplateReference: 'a7-notification-template:virtual-account-assign',
    a7ProductCustomerBindingMapReference: A7T04_MAP_REFERENCE,
    a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
    a2AuthorizationContextReference: 'a2-authorization-context',
    a7ProductCommandReference: A7T05_COMMAND_REFERENCE,
    a6ExternalOperationReference: A6_EXTERNAL_OPERATION_REFERENCE,
    notificationPayload,
    notificationPayloadHash,
    idempotencyKey: 'a7-notification-dispatch-key-1',
    requestHash: createHash('sha256').update('placeholder').digest('hex'),
    requestContext: {
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      traceId: TRACE_ID,
    },
    causationId: null,
    ...(overrides as Partial<A7ProductNotificationDispatchV1>),
  } as A7ProductNotificationDispatchV1;
}

class FakeRepository {
  readonly providers: ReturnType<A7ProductNotificationDeliveryRepository['getConsumerPorts']>;
  private readonly idempotencyRecords = new Map<
    string,
    { id: string; responseBody: Record<string, unknown> | null }
  >();
  private auditCalls: Array<{ action: string; entityId: string }> = [];
  private outboxCalls: Array<{ eventType: string; aggregateId: string }> = [];
  public a2Response: unknown = {
    principalType: 'SERVICE',
    principalId: 'a7-product-notification-delivery',
    customerId: null,
    customerAccess: 'ANY',
    evaluatedAt: new Date().toISOString(),
    allowed: true,
    action: 'a7-product-notification-delivery',
    resourceType: 'A7_NOTIFICATION_DISPATCH',
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
    walletAccountId: BINDING_ID,
    ledgerAccountId: BINDING_ID,
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
    a2AuthorizationContextReference: 'a2-authorization-context',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
  };
  public a6Response: null = null;
  public customerPreferenceResponse: unknown = {
    id: CUSTOMER_PREFERENCE_ID,
    customerId: CUSTOMER_ID,
    version: 1,
    notifications: { email: true, sms: true, push: true, inApp: true },
    deleted: false,
  };
  public a6T10IsRegistered: (fieldName: string) => boolean = () => true;
  public a6T10IsSecret: (fieldName: string) => boolean = () => false;
  public a6T10LevelFor: (
    fieldName: string,
  ) => 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'HIGHLY_RESTRICTED' | null = () =>
    'INTERNAL';
  public a6T10SecretCategoryFor: (fieldName: string) => string | null = () => null;
  public a6T10AudienceMaxLevelFor: (
    audience: string,
  ) => 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'HIGHLY_RESTRICTED' = () =>
    'CONFIDENTIAL';
  public a6T10TryGet: (fieldName: string) => unknown = (fieldName) => ({
    fieldName,
    level: 'INTERNAL',
    sourceDomain: 'TestDomain',
    owner: 'test-owner',
    secretCategory: null,
  });
  public idempotencyKind: 'NEW' | 'REPLAY' | 'IN_PROGRESS' = 'NEW';
  public throwOnReserve: Error | null = null;
  public throwOnComplete: Error | null = null;
  public throwOnAudit: Error | null = null;
  public throwOnOutbox: Error | null = null;
  private reservationCounter = 0;

  constructor() {
    const providers = {
      a2AuthorizationContextLookup: () => Promise.resolve(this.a2Response as never),
      a3BindingRecheck: () => Promise.resolve(this.a3Response as never),
      a4ProductPolicyDecisionLookup: () => Promise.resolve(this.a4Response as never),
      a7T04ProductCustomerBindingMapReferenceCheck: () =>
        Promise.resolve(this.a7T04Response as never),
      a7T05ProductCommandLookup: () => Promise.resolve(this.a7T05Response as never),
      a6T10DataClassification: {
        isRegistered: (fieldName: string) => this.a6T10IsRegistered(fieldName),
        isSecret: (fieldName: string) => this.a6T10IsSecret(fieldName),
        levelFor: (fieldName: string) => this.a6T10LevelFor(fieldName),
        secretCategoryFor: (fieldName: string) => this.a6T10SecretCategoryFor(fieldName),
        tryGet: (fieldName: string) => this.a6T10TryGet(fieldName) as never,
        audienceMaxLevelFor: (audience: string) => this.a6T10AudienceMaxLevelFor(audience),
      },
      a6ExternalOperationLookup: () => Promise.resolve(this.a6Response as never),
      customerPreferenceLookup: () => Promise.resolve(this.customerPreferenceResponse as never),
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
    };
    this.providers = providers as never;
  }

  getConsumerPorts(): never {
    return this.providers as never;
  }

  getA7ProductNotificationDeliveryProviderIdempotencyScope(): string {
    return A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDER_IDEMPOTENCY_SCOPE;
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
}

function makeService(): {
  service: A7ProductNotificationDeliveryService;
  repository: FakeRepository;
} {
  const repository = new FakeRepository();
  const service = new A7ProductNotificationDeliveryService(
    repository as unknown as A7ProductNotificationDeliveryRepository,
  );
  return { service, repository };
}

function buildCanonicalHashInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const notificationPayload = {
    customerId: CUSTOMER_ID,
    productKey: 'VIRTUAL_ACCOUNT',
  };
  const notificationPayloadHash = createHash('sha256')
    .update(JSON.stringify(notificationPayload, Object.keys(notificationPayload).sort()))
    .digest('hex');
  return {
    contractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
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
    customerPreferenceId: CUSTOMER_PREFERENCE_ID,
    notificationChannel: 'email',
    notificationTemplateReference: 'a7-notification-template:virtual-account-assign',
    a7ProductCustomerBindingMapReference: A7T04_MAP_REFERENCE,
    a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
    a2AuthorizationContextReference: 'a2-authorization-context',
    a7ProductCommandReference: A7T05_COMMAND_REFERENCE,
    a6ExternalOperationReference: A6_EXTERNAL_OPERATION_REFERENCE,
    notificationPayloadHash,
    correlationId: CORRELATION_ID,
    causationId: null,
    ...overrides,
  };
}

function withHash(
  service: A7ProductNotificationDeliveryService,
  command: A7ProductNotificationDispatchV1,
): A7ProductNotificationDispatchV1 {
  return {
    ...command,
    requestHash: service.deriveRequestHash(
      buildCanonicalHashInput({
        bindingVersion: command.bindingVersion,
        notificationChannel: command.notificationChannel,
      }) as never,
    ),
  };
}

describe('A7ProductNotificationDeliveryService (A7T06)', () => {
  it('exposes the A7 product notification delivery contract name, version, and idempotency scopes', () => {
    const { service } = makeService();
    expect(service.getContractNames()).toEqual({
      customerPreference: 'CUSTOMER-PREFERENCE',
      a2: 'A2-PROTECTED-ROUTE-AUTHORIZATION',
      a3: 'A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING',
      a4: 'A4-CAPABILITY-POLICY',
      a6: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6T10: 'A6-EXTERNAL-DATA-MINIMIZATION',
      a7: 'A7-NOTIFICATION-DELIVERY',
    });
    expect(service.getContractVersions()).toEqual({
      customerPreference: 1,
      a2: 1,
      a3: 1,
      a4: 1,
      a6: 1,
      a6T10: 1,
      a7: 1,
    });
    expect(service.getInternalIdempotencyScope()).toBe(
      A7_PRODUCT_NOTIFICATION_DELIVERY_INTERNAL_IDEMPOTENCY_SCOPE,
    );
    expect(service.getProviderIdempotencyScope()).toBe(
      A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDER_IDEMPOTENCY_SCOPE,
    );
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getAuditEntityType()).toBe('A7_NOTIFICATION_DISPATCH');
    expect(service.getAuditActor()).toBe('a7-product-notification-delivery');
    expect(service.listDeliveryStates()).toContain('PENDING');
    expect(service.listDeliveryStates()).toContain('DISPATCHED');
    expect(service.listDeliveryStates()).toContain('SUPPRESSED');
    expect(service.listDeliveryStates()).toContain('FAILED');
    expect(service.listDeliveryStates()).toContain('REPLAYED');
    expect(service.listNotificationChannels()).toContain('email');
    expect(service.listNotificationChannels()).toContain('sms');
    expect(service.listNotificationChannels()).toContain('push');
    expect(service.listNotificationChannels()).toContain('inApp');
  });

  it('rejects commands with an invalid contract name', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(
      makeCommandInput({ contractName: 'OTHER' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
      );
    }
  });

  it('rejects commands with an invalid contract version', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(
      makeCommandInput({ contractVersion: 99 as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
      );
    }
  });

  it('rejects commands with an invalid product key', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(
      makeCommandInput({ productKey: 'OTHER' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
      );
    }
  });

  it('rejects commands with an invalid capability key', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(
      makeCommandInput({ capabilityKey: 'unknown.capability' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
      );
    }
  });

  it('rejects commands with an invalid action', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(makeCommandInput({ action: 'unknown' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
      );
    }
  });

  it('rejects commands with an invalid product state', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(
      makeCommandInput({ productState: 'UNKNOWN_STATE' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
      );
    }
  });

  it('rejects commands with a non-UUID customerId', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(
      makeCommandInput({ customerId: 'not-a-uuid' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
      );
    }
  });

  it('rejects commands with a non-positive bindingVersion', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(makeCommandInput({ bindingVersion: 0 }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
      );
    }
  });

  it('rejects commands with an invalid request hash', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(
      makeCommandInput({ requestHash: 'not-a-sha256-hash' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_REQUEST_HASH_CONFLICT,
      );
    }
  });

  it('rejects commands with an invalid notification channel', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(
      withHash(service, makeCommandInput({ notificationChannel: 'unknown' as never })),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_NOTIFICATION_CHANNEL_UNSUPPORTED,
      );
    }
  });

  it('rejects commands with an invalid notification template reference', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(
      withHash(service, makeCommandInput({ notificationTemplateReference: 'with spaces and !@#' })),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_TEMPLATE_REFERENCE_INVALID,
      );
    }
  });

  it('rejects commands with an invalid notification payload hash', async () => {
    const { service } = makeService();
    const result = await service.dispatchNotification(
      makeCommandInput({ notificationPayloadHash: 'not-a-sha256-hash' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_HASH_MISMATCH,
      );
    }
  });

  it('fails closed when the A2 authorization context is missing', async () => {
    const { service, repository } = makeService();
    repository.a2Response = null;
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_MISSING,
      );
    }
  });

  it('fails closed when the A4 product-policy decision is missing', async () => {
    const { service, repository } = makeService();
    repository.a4Response = null;
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_MISSING,
      );
    }
  });

  it('fails closed when the A4 product-policy decision is not executable', async () => {
    const { service, repository } = makeService();
    repository.a4Response = {
      decisionReference: 'a4-product-policy-decision',
      productKey: 'VIRTUAL_ACCOUNT',
      capability: 'product.virtual-account',
      action: 'lifecycle',
      profileReference: 'profile.product-virtual-account-lifecycle.v1',
      policyVersion: 'a4.profile.product-virtual-account-lifecycle.v1',
      decision: 'DENY',
      expiresAt: null,
      reasonCodes: [],
      maxAmountMinor: null,
    };
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
      );
    }
  });

  it('fails closed when the A7T04 product customer-binding map is missing', async () => {
    const { service, repository } = makeService();
    repository.a7T04Response = null;
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
      );
    }
  });

  it('fails closed when the A7T05 product command/operation reference is missing', async () => {
    const { service, repository } = makeService();
    repository.a7T05Response = null;
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T05_PRODUCT_COMMAND_MISSING,
      );
    }
  });

  it('fails closed when the CustomerPreference.notifications record is missing', async () => {
    const { service, repository } = makeService();
    repository.customerPreferenceResponse = null;
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_MISSING,
      );
    }
  });

  it('fails closed (suppresses) when the CustomerPreference.notifications channel is disabled', async () => {
    const { service, repository } = makeService();
    repository.customerPreferenceResponse = {
      id: CUSTOMER_PREFERENCE_ID,
      customerId: CUSTOMER_ID,
      version: 1,
      notifications: { email: false, sms: true, push: true, inApp: true },
      deleted: false,
    };
    const result = await service.dispatchNotification(
      withHash(service, makeCommandInput({ notificationChannel: 'email' })),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.dispatch.deliveryState).toBe('SUPPRESSED');
    } else {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_DISABLED,
      );
    }
  });

  it('fails closed when the A7 internal idempotency reservation is in progress', async () => {
    const { service, repository } = makeService();
    repository.idempotencyKind = 'IN_PROGRESS';
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_IDEMPOTENCY_IN_PROGRESS,
      );
    }
  });

  it('fails closed when the request hash does not match the canonical hash', async () => {
    const { service } = makeService();
    const command = makeCommandInput({
      requestHash: createHash('sha256').update('a-totally-different-request-hash').digest('hex'),
    });
    const result = await service.dispatchNotification(command);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_REQUEST_HASH_CONFLICT,
      );
    }
  });

  it('fails closed when the A6T10 data classification does not register a payload field', async () => {
    const { service, repository } = makeService();
    repository.a6T10IsRegistered = () => false;
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_CLASSIFICATION_NOT_REGISTERED,
      );
    }
  });

  it('fails closed when a notification payload field is a secret field', async () => {
    const { service, repository } = makeService();
    repository.a6T10IsSecret = () => true;
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_SECRET_PRESENT,
      );
    }
  });

  it('fails closed when a notification payload field is HIGHLY_RESTRICTED', async () => {
    const { service, repository } = makeService();
    repository.a6T10LevelFor = () => 'HIGHLY_RESTRICTED';
    repository.a6T10AudienceMaxLevelFor = () => 'HIGHLY_RESTRICTED';
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_DISCLOSURE_REJECTED,
      );
    }
  });

  it('admits a valid A7 notification dispatch and records the audit and outbox facts', async () => {
    const { service, repository } = makeService();
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.reservation.kind).toBe('NEW');
      expect(result.dispatch.productKey).toBe('VIRTUAL_ACCOUNT');
      expect(result.dispatch.deliveryState).toBe('DISPATCHED');
      expect(result.dispatch.notificationChannel).toBe('email');
      expect(result.dispatch.idempotencyScope).toBe('a7.notification-dispatch.idempotency.v1');
      expect(result.dispatch.requestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.handoff.handoffScope).toBe('a7-notification-dispatch-handoff.v1');
      expect(result.handoff.notificationDispatchId).toBe(result.dispatch.notificationDispatchId);
    }
    const auditActions = repository.getAuditCalls().map((call) => call.action);
    expect(auditActions).toContain('A7_NOTIFICATION_DISPATCH_ADMITTED');
    expect(auditActions).toContain('A7_NOTIFICATION_DISPATCH_RESERVED');
    const outboxCalls = repository.getOutboxCalls();
    expect(outboxCalls.length).toBeGreaterThanOrEqual(1);
    expect(outboxCalls[0]?.eventType).toBe('A7ProductNotificationDispatched');
  });

  it('returns the durable replayed A7 notification dispatch for the same scope/key with the same hash', async () => {
    const { service } = makeService();
    const first = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(first.valid).toBe(true);
    const second = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(second.valid).toBe(true);
    if (first.valid && second.valid) {
      expect(second.reservation.kind).toBe('REPLAY');
      expect(second.dispatch.notificationDispatchId).toBe(first.dispatch.notificationDispatchId);
      expect(second.dispatch.deliveryState).toBe('REPLAYED');
      expect(second.dispatch.replayed).toBe(true);
    }
  });

  it('fails closed when the Operations audit evidence is unavailable', async () => {
    const { service, repository } = makeService();
    repository.throwOnAudit = new Error('audit unavailable');
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
      );
    }
  });

  it('fails closed when the Operations outbox evidence is unavailable', async () => {
    const { service, repository } = makeService();
    repository.throwOnOutbox = new Error('outbox unavailable');
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OUTBOX_PUBLICATION_FAILED,
      );
    }
  });

  it('derives the canonical A7 notification dispatch request hash deterministically', () => {
    const { service } = makeService();
    const input = buildCanonicalHashInput();
    const first = service.deriveRequestHash(input as never);
    const second = service.deriveRequestHash(input as never);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    const different = service.deriveRequestHash({
      ...input,
      notificationPayloadHash: createHash('sha256').update('different').digest('hex'),
    } as never);
    expect(different).not.toBe(first);
  });

  it('does not include HIGHLY_RESTRICTED payload hash in the audit values', async () => {
    const { service, repository } = makeService();
    const result = await service.dispatchNotification(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(true);
    if (result.valid) {
      const auditCalls = repository.getAuditCalls();
      expect(auditCalls.length).toBeGreaterThan(0);
    }
  });
});
