import { createHash } from 'node:crypto';

import { A7ProductCommandService } from '../src/policy/a7-product-command.service';
import type { A7ProductCommandRepository } from '../src/policy/a7-product-command.repository';
import type { A7ProductCommandCreateV1 } from '../src/policy/a7-product-command.types';
import {
  A7_PRODUCT_COMMAND_CONTRACT_NAME,
  A7_PRODUCT_COMMAND_CONTRACT_VERSION,
  A7_PRODUCT_COMMAND_INTERNAL_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_COMMAND_PROVIDER_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_COMMAND_FAILURE_A2_AUTHORIZATION_MISSING,
  A7_PRODUCT_COMMAND_FAILURE_A3_BINDING_MISSING,
  A7_PRODUCT_COMMAND_FAILURE_A3_STALE_BINDING,
  A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_MISSING,
  A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
  A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_NOT_FOUND,
  A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
  A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT,
  A7_PRODUCT_COMMAND_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
  A7_PRODUCT_COMMAND_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED,
  A7_PRODUCT_COMMAND_FAILURE_CURRENCY_MISMATCH,
  A7_PRODUCT_COMMAND_FAILURE_ACCOUNTING_UNIT_MISMATCH,
  A7_PRODUCT_COMMAND_FAILURE_IDEMPOTENCY_IN_PROGRESS,
  A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED,
  A7_PRODUCT_COMMAND_FAILURE_REQUEST_HASH_CONFLICT,
  A7_PRODUCT_COMMAND_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
} from '../src/policy/a7-product-command.constants';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const BINDING_ID = '00000000-0000-4000-8000-000000000003';
const A6_EXTERNAL_OPERATION_ID = '00000000-0000-4000-8000-000000000004';
const A7T04_MAP_REFERENCE = createHash('sha256')
  .update('a7-product-customer-binding-v1')
  .digest('hex');
const REQUEST_ID = 'request-a7t05-1';
const CORRELATION_ID = 'correlation-a7t05-1';
const TRACE_ID = 'trace-a7t05-1';

function makeCommandInput(overrides: Record<string, unknown> = {}): A7ProductCommandCreateV1 {
  return {
    contractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
    contractVersion: A7_PRODUCT_COMMAND_CONTRACT_VERSION,
    productKey: 'VIRTUAL_ACCOUNT',
    productVersion: 1,
    capabilityKey: 'virtual-account.assign',
    action: 'assign',
    productState: 'ASSIGN_REQUESTED',
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    bindingId: BINDING_ID,
    bindingVersion: 1,
    amountMinor: '1000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    a7ProductCustomerBindingMapReference: A7T04_MAP_REFERENCE,
    a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
    a2AuthorizationContextReference: 'a2-authorization-context',
    a6ExternalOperationId: A6_EXTERNAL_OPERATION_ID,
    a6ExternalOperationReference: 'external-operation:v1:abc',
    a6ProviderIdempotencyScope: 'nibss.nip.external-operation.v1',
    a6ProviderIdempotencyKey: 'nibss.nip.external-operation.v1:abc',
    idempotencyKey: 'a7-product-command-key-1',
    requestHash: createHash('sha256').update('placeholder').digest('hex'),
    requestContext: {
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      traceId: TRACE_ID,
    },
    causationId: null,
    ...(overrides as Partial<A7ProductCommandCreateV1>),
  } as A7ProductCommandCreateV1;
}

class FakeRepository {
  readonly providers: ReturnType<A7ProductCommandRepository['getConsumerPorts']>;
  private readonly idempotencyRecords = new Map<
    string,
    { id: string; responseBody: Record<string, unknown> | null }
  >();
  private auditCalls: Array<{ action: string; entityId: string }> = [];
  private outboxCalls: Array<{ eventType: string; aggregateId: string }> = [];
  public a2Response: unknown = {
    principalType: 'SERVICE',
    principalId: 'a7-product-command',
    customerId: null,
    customerAccess: 'ANY',
    evaluatedAt: new Date().toISOString(),
    allowed: true,
    action: 'a7-product-command',
    resourceType: 'A7_PRODUCT_COMMAND',
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
  public a6Response: unknown = {
    externalOperationId: A6_EXTERNAL_OPERATION_ID,
    externalOperationReference: 'external-operation:v1:abc',
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    resourceType: 'WITHDRAWAL',
    resourceId: '00000000-0000-4000-8000-000000000099',
    internalCommandId: '00000000-0000-4000-8000-000000000098',
    customerId: CUSTOMER_ID,
    walletAccountId: BINDING_ID,
    ledgerAccountId: BINDING_ID,
    amountMinor: '1000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    internalIdempotencyScope: 'external.partner.operation.v1',
    internalIdempotencyKey: 'external-operation-key-1',
    providerIdempotencyScope: 'nibss.nip.external-operation.v1',
    providerIdempotencyKey: 'nibss.nip.external-operation.v1:abc',
    requestHash: 'request-hash-a6',
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    traceId: TRACE_ID,
    causationId: null,
    lifecycleState: 'CREATED',
    replayed: false,
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
    a6PartnerIdentity: { partnerKey: 'NIBSS_NIP' },
    a6PartnerCorrelation: { correlationId: CORRELATION_ID },
    a6PartnerReference: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
  public a6IdempotencyKind: 'NEW' | 'REPLAY' | 'IN_PROGRESS' = 'NEW';
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
      a6ExternalOperationLookup: () => Promise.resolve(this.a6Response as never),
      a7T04ProductCustomerBindingMapReferenceCheck: () =>
        Promise.resolve(this.a7T04Response as never),
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
        if (this.a6IdempotencyKind === 'IN_PROGRESS') {
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

  getA7ProductProviderIdempotencyScope(): string {
    return A7_PRODUCT_COMMAND_PROVIDER_IDEMPOTENCY_SCOPE;
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
  service: A7ProductCommandService;
  repository: FakeRepository;
} {
  const repository = new FakeRepository();
  const service = new A7ProductCommandService(repository as unknown as A7ProductCommandRepository);
  return { service, repository };
}

function buildCanonicalHashInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractName: A7_PRODUCT_COMMAND_CONTRACT_NAME,
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
    amountMinor: '1000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    a7ProductCustomerBindingMapReference: A7T04_MAP_REFERENCE,
    a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
    a2AuthorizationContextReference: 'a2-authorization-context',
    a6ExternalOperationId: A6_EXTERNAL_OPERATION_ID,
    a6ProviderIdempotencyScope: 'nibss.nip.external-operation.v1',
    a6ProviderIdempotencyKey: 'nibss.nip.external-operation.v1:abc',
    correlationId: CORRELATION_ID,
    causationId: null,
    ...overrides,
  };
}

function withHash(
  service: A7ProductCommandService,
  command: A7ProductCommandCreateV1,
): A7ProductCommandCreateV1 {
  return {
    ...command,
    requestHash: service.deriveRequestHash(
      buildCanonicalHashInput({
        a6ExternalOperationId: command.a6ExternalOperationId,
        a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
        a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
        amountMinor: command.amountMinor,
        bindingVersion: command.bindingVersion,
      }) as never,
    ),
  };
}

describe('A7ProductCommandService (A7T05)', () => {
  it('exposes the A7 product command contract name, version, and idempotency scopes', () => {
    const { service } = makeService();
    expect(service.getContractNames()).toEqual({
      a4: 'A4-CAPABILITY-POLICY',
      a6: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a7: 'A7-PRODUCT-COMMAND',
    });
    expect(service.getContractVersions()).toEqual({ a4: 1, a6: 1, a7: 1 });
    expect(service.getInternalIdempotencyScope()).toBe(
      A7_PRODUCT_COMMAND_INTERNAL_IDEMPOTENCY_SCOPE,
    );
    expect(service.getProviderIdempotencyScope()).toBe(
      A7_PRODUCT_COMMAND_PROVIDER_IDEMPOTENCY_SCOPE,
    );
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getAuditEntityType()).toBe('A7_PRODUCT_COMMAND');
    expect(service.getAuditActor()).toBe('a7-product-command');
    expect(service.listOperationStates()).toContain('COMMAND_RESERVED');
    expect(service.listOperationStates()).toContain('COMMAND_ADMITTED');
    expect(service.listOperationStates()).toContain('COMMAND_COMPLETED');
    expect(service.listOperationStates()).toContain('COMMAND_FAILED');
    expect(service.listOperationStates()).toContain('COMMAND_REPLAYED');
    expect(service.listOperationStates()).toContain('COMMAND_CONFLICTED');
  });

  it('rejects commands with an invalid contract name', async () => {
    const { service } = makeService();
    const result = await service.reserveProductCommand(
      makeCommandInput({ contractName: 'OTHER' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid contract version', async () => {
    const { service } = makeService();
    const result = await service.reserveProductCommand(
      makeCommandInput({ contractVersion: 99 as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid product key', async () => {
    const { service } = makeService();
    const result = await service.reserveProductCommand(
      makeCommandInput({ productKey: 'OTHER' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid capability key', async () => {
    const { service } = makeService();
    const result = await service.reserveProductCommand(
      makeCommandInput({ capabilityKey: 'unknown.capability' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid action', async () => {
    const { service } = makeService();
    const result = await service.reserveProductCommand(makeCommandInput({ action: 'unknown' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with an invalid product state', async () => {
    const { service } = makeService();
    const result = await service.reserveProductCommand(
      makeCommandInput({ productState: 'UNKNOWN_STATE' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED);
    }
  });

  it('rejects commands with a non-NGN currency', async () => {
    const { service } = makeService();
    const result = await service.reserveProductCommand(
      makeCommandInput({ currency: 'USD' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_CURRENCY_MISMATCH);
    }
  });

  it('rejects commands with a non-CUSTOMER_FUNDS accounting unit', async () => {
    const { service } = makeService();
    const result = await service.reserveProductCommand(
      makeCommandInput({ accountingUnit: 'VAULT' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_ACCOUNTING_UNIT_MISMATCH);
    }
  });

  it('rejects commands with a non-UUID customerId', async () => {
    const { service } = makeService();
    const result = await service.reserveProductCommand(
      makeCommandInput({ customerId: 'not-a-uuid' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_A3_BINDING_MISSING);
    }
  });

  it('rejects commands with a non-positive bindingVersion', async () => {
    const { service } = makeService();
    const result = await service.reserveProductCommand(makeCommandInput({ bindingVersion: 0 }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_A3_STALE_BINDING);
    }
  });

  it('rejects commands with an invalid request hash', async () => {
    const { service } = makeService();
    const result = await service.reserveProductCommand(
      makeCommandInput({ requestHash: 'not-a-sha256-hash' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_REQUEST_HASH_CONFLICT);
    }
  });

  it('fails closed when the A2 authorization context is missing', async () => {
    const { service, repository } = makeService();
    repository.a2Response = null;
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_A2_AUTHORIZATION_MISSING);
    }
  });

  it('fails closed when the A4 product-policy decision is missing', async () => {
    const { service, repository } = makeService();
    repository.a4Response = null;
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_MISSING);
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
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
      );
    }
  });

  it('fails closed when the A6T05 external-operation record is not found', async () => {
    const { service, repository } = makeService();
    repository.a6Response = null;
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_NOT_FOUND);
    }
  });

  it('fails closed when the A6T05 external-operation context does not match', async () => {
    const { service, repository } = makeService();
    repository.a6Response = {
      externalOperationId: A6_EXTERNAL_OPERATION_ID,
      externalOperationReference: 'external-operation:v1:abc',
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      resourceType: 'WITHDRAWAL',
      resourceId: '00000000-0000-4000-8000-000000000099',
      internalCommandId: '00000000-0000-4000-8000-000000000098',
      customerId: CUSTOMER_ID,
      walletAccountId: BINDING_ID,
      ledgerAccountId: BINDING_ID,
      amountMinor: '2000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      internalIdempotencyScope: 'external.partner.operation.v1',
      internalIdempotencyKey: 'external-operation-key-1',
      providerIdempotencyScope: 'nibss.nip.external-operation.v1',
      providerIdempotencyKey: 'nibss.nip.external-operation.v1:abc',
      requestHash: 'request-hash-a6',
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      traceId: TRACE_ID,
      causationId: null,
      lifecycleState: 'CREATED',
      replayed: false,
    };
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
      );
    }
  });

  it('fails closed when the A6T05 external-operation reference does not match', async () => {
    const { service, repository } = makeService();
    repository.a6Response = {
      externalOperationId: A6_EXTERNAL_OPERATION_ID,
      externalOperationReference: 'external-operation:v1:DIFFERENT',
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      resourceType: 'WITHDRAWAL',
      resourceId: '00000000-0000-4000-8000-000000000099',
      internalCommandId: '00000000-0000-4000-8000-000000000098',
      customerId: CUSTOMER_ID,
      walletAccountId: BINDING_ID,
      ledgerAccountId: BINDING_ID,
      amountMinor: '1000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      internalIdempotencyScope: 'external.partner.operation.v1',
      internalIdempotencyKey: 'external-operation-key-1',
      providerIdempotencyScope: 'nibss.nip.external-operation.v1',
      providerIdempotencyKey: 'nibss.nip.external-operation.v1:abc',
      requestHash: 'request-hash-a6',
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      traceId: TRACE_ID,
      causationId: null,
      lifecycleState: 'CREATED',
      replayed: false,
    };
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT,
      );
    }
  });

  it('fails closed when the A7T04 product customer-binding map is missing', async () => {
    const { service, repository } = makeService();
    repository.a7T04Response = null;
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_COMMAND_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
      );
    }
  });

  it('fails closed when the A7T04 product customer-binding map product key does not match', async () => {
    const { service, repository } = makeService();
    repository.a7T04Response = {
      mapReference: A7T04_MAP_REFERENCE,
      productKey: 'OTHER_PRODUCT',
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
      a6PartnerIdentity: { partnerKey: 'NIBSS_NIP' },
      a6PartnerCorrelation: { correlationId: CORRELATION_ID },
      a6PartnerReference: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(
        A7_PRODUCT_COMMAND_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED,
      );
    }
  });

  it('fails closed when the A7 idempotency reservation is in progress', async () => {
    const { service, repository } = makeService();
    repository.a6IdempotencyKind = 'IN_PROGRESS';
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_IDEMPOTENCY_IN_PROGRESS);
    }
  });

  it('fails closed when the request hash does not match the canonical hash', async () => {
    const { service } = makeService();
    const command = makeCommandInput({
      requestHash: createHash('sha256').update('a-totally-different-request-hash').digest('hex'),
    });
    const result = await service.reserveProductCommand(command);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_REQUEST_HASH_CONFLICT);
    }
  });

  it('admits a valid A7 product command and records the audit and outbox facts', async () => {
    const { service, repository } = makeService();
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.reservation.kind).toBe('NEW');
      expect(result.operation.productKey).toBe('VIRTUAL_ACCOUNT');
      expect(result.operation.operationState).toBe('COMMAND_ADMITTED');
      expect(result.operation.a6ExternalOperationId).toBe(A6_EXTERNAL_OPERATION_ID);
      expect(result.operation.a7ProductCustomerBindingMapReference).toBe(A7T04_MAP_REFERENCE);
      expect(result.operation.idempotencyScope).toBe('A7-PRODUCT-IDEMPOTENCY.v1');
      expect(result.operation.requestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.handoff.handoffScope).toBe('a7-product-command-handoff.v1');
      expect(result.handoff.productCommandId).toBe(result.operation.productCommandId);
    }
    const auditActions = repository.getAuditCalls().map((call) => call.action);
    expect(auditActions).toContain('A7_PRODUCT_COMMAND_ADMITTED');
    expect(auditActions).toContain('A7_PRODUCT_COMMAND_RESERVED');
    const outboxCalls = repository.getOutboxCalls();
    expect(outboxCalls.length).toBeGreaterThanOrEqual(1);
    expect(outboxCalls[0]?.eventType).toBe('A7ProductCommandAdmitted');
  });

  it('returns the durable replayed A7 product command for the same scope/key with the same hash', async () => {
    const { service } = makeService();
    const first = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(first.valid).toBe(true);
    const second = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(second.valid).toBe(true);
    if (first.valid && second.valid) {
      expect(second.reservation.kind).toBe('REPLAY');
      expect(second.operation.productCommandId).toBe(first.operation.productCommandId);
      expect(second.operation.replayed).toBe(true);
    }
  });

  it('fails closed when the Operations audit evidence is unavailable', async () => {
    const { service, repository } = makeService();
    repository.throwOnAudit = new Error('audit unavailable');
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE);
    }
  });

  it('fails closed when the Operations outbox evidence is unavailable', async () => {
    const { service, repository } = makeService();
    repository.throwOnOutbox = new Error('outbox unavailable');
    const result = await service.reserveProductCommand(withHash(service, makeCommandInput()));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_COMMAND_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE);
    }
  });

  it('derives the canonical A7 product request hash deterministically', () => {
    const { service } = makeService();
    const input = buildCanonicalHashInput();
    const first = service.deriveRequestHash(input as never);
    const second = service.deriveRequestHash(input as never);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    const different = service.deriveRequestHash({
      ...input,
      amountMinor: '2000',
    } as never);
    expect(different).not.toBe(first);
  });
});
