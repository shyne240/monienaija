import { ConfigService } from '@nestjs/config';

import { ExternalOperation } from '../src/partner/external-operation.entity';
import { ExternalOperationResourceType } from '../src/partner/external-operation.enums';
import { ExternalOperationLifecycleState } from '../src/partner/external-operation-lifecycle.enums';
import { ExternalOperationLifecycleService } from '../src/partner/external-operation-lifecycle.service';
import { PartnerCircuitBreakerService } from '../src/partner/partner-circuit-breaker.service';
import { UnavailableExternalOperationStatusVerifier } from '../src/partner/external-operation-status-verifier';
import type { ExternalOperationLifecycleView } from '../src/partner/external-operation-lifecycle.types';

const OPERATION_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000002';
const WALLET_ID = '00000000-0000-4000-8000-000000000003';
const LEDGER_ID = '00000000-0000-4000-8000-000000000004';
const RESOURCE_ID = '00000000-0000-4000-8000-000000000005';
const COMMAND_ID = '00000000-0000-4000-8000-000000000006';
const TARGET_MAPPING_REFERENCE = `a6-target:${'a'.repeat(64)}`;

class FakeOperationRepository {
  constructor(readonly operation: ExternalOperation) {}

  create(input: Partial<ExternalOperation>): ExternalOperation {
    return input as ExternalOperation;
  }

  save(operation: ExternalOperation): ExternalOperation {
    Object.assign(this.operation, operation);
    this.operation.updatedAt = new Date();
    this.operation.version += 1;
    return this.operation;
  }

  findOne(options: { where: { id?: string } }) {
    return options.where.id === this.operation.id ? this.operation : null;
  }

  createQueryBuilder(): FakeOperationQueryBuilder {
    return new FakeOperationQueryBuilder(this.operation);
  }
}

class FakeOperationQueryBuilder {
  constructor(private readonly operation: ExternalOperation) {}

  where(): this {
    return this;
  }

  setLock(): this {
    return this;
  }

  getOne(): Promise<ExternalOperation> {
    return Promise.resolve(this.operation);
  }
}

class FakeReferenceRepository {
  find(): [] {
    return [];
  }
}

class FakeManager {
  constructor(
    readonly operations: FakeOperationRepository,
    readonly references: FakeReferenceRepository,
  ) {}

  getRepository(target: unknown) {
    if (target === ExternalOperation) return this.operations;
    return this.references;
  }
}

class FakeDataSource {
  constructor(private readonly manager: FakeManager) {}

  transaction<T>(_isolation: string, callback: (manager: FakeManager) => Promise<T>): Promise<T> {
    return callback(this.manager);
  }
}

class FakeIdempotencyService {
  readonly records = new Map<
    string,
    { id: string; hash: string; resourceId: string | null; body?: Record<string, unknown> }
  >();
  private nextId = 1;

  reserve(_manager: unknown, command: { scope: string; key: string; requestHash: string }) {
    const mapKey = `${command.scope}:${command.key}`;
    const existing = this.records.get(mapKey);
    if (existing) {
      if (existing.hash !== command.requestHash) throw new Error('idempotency conflict');
      return { kind: 'REPLAY' as const, record: { ...existing, resourceId: existing.resourceId } };
    }
    const record = {
      id: `lifecycle-idempotency-${this.nextId++}`,
      hash: command.requestHash,
      resourceId: null,
    };
    this.records.set(mapKey, record);
    return { kind: 'NEW' as const, record };
  }

  complete(
    _manager: unknown,
    recordId: string,
    command: { responseBody: Record<string, unknown>; resourceId?: string },
  ) {
    const record = [...this.records.values()].find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('missing lifecycle idempotency record');
    record.body = command.responseBody;
    record.resourceId = command.resourceId ?? null;
  }
}

function makeOperation(): ExternalOperation {
  const now = new Date();
  return {
    id: OPERATION_ID,
    operationVersion: 1,
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    resourceType: ExternalOperationResourceType.WITHDRAWAL,
    resourceId: RESOURCE_ID,
    internalCommandId: COMMAND_ID,
    customerId: CUSTOMER_ID,
    walletAccountId: WALLET_ID,
    ledgerAccountId: LEDGER_ID,
    targetMappingReference: TARGET_MAPPING_REFERENCE,
    amountMinor: '1000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    internalIdempotencyScope: 'external.partner.operation.v1',
    internalIdempotencyKey: 'operation-key',
    providerIdempotencyScope: 'nibss.nip.external-operation.v1',
    providerIdempotencyKey: 'provider-key',
    requestHash: 'b'.repeat(64),
    requestId: 'request-1',
    correlationId: 'correlation-1',
    traceId: 'trace-1',
    causationId: null,
    lifecycleState: ExternalOperationLifecycleState.CREATED,
    attemptCount: 0,
    maxAttempts: 3,
    nextRetryAt: null,
    lastAttemptAt: null,
    providerStatus: null,
    failureCode: null,
    failureMessage: null,
    failureStatusCode: null,
    recoveryReference: null,
    submittingAt: null,
    pendingAt: null,
    pendingVerificationAt: null,
    unknownAt: null,
    manualReviewAt: null,
    failedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function makeView(operation: ExternalOperation): ExternalOperationLifecycleView {
  return {
    operationVersion: 1,
    externalOperationId: operation.id,
    externalOperationReference: `external-operation:v1:${'c'.repeat(64)}`,
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    resourceType: ExternalOperationResourceType.WITHDRAWAL,
    resourceId: operation.resourceId,
    internalCommandId: operation.internalCommandId,
    customerId: operation.customerId,
    walletAccountId: operation.walletAccountId,
    ledgerAccountId: operation.ledgerAccountId,
    targetMappingReference: operation.targetMappingReference,
    amountMinor: operation.amountMinor,
    currency: operation.currency,
    accountingUnit: 'CUSTOMER_FUNDS',
    internalIdempotencyScope: operation.internalIdempotencyScope,
    internalIdempotencyKey: operation.internalIdempotencyKey,
    providerIdempotencyScope: operation.providerIdempotencyScope,
    providerIdempotencyKey: operation.providerIdempotencyKey,
    requestHash: operation.requestHash,
    requestContext: {
      requestId: operation.requestId,
      correlationId: operation.correlationId,
      traceId: operation.traceId ?? operation.requestId,
    },
    causationId: operation.causationId,
    lifecycleState: operation.lifecycleState,
    attemptCount: operation.attemptCount,
    maxAttempts: operation.maxAttempts,
    nextRetryAt: operation.nextRetryAt,
    lastAttemptAt: operation.lastAttemptAt,
    providerStatus: operation.providerStatus,
    failureCode: operation.failureCode,
    failureMessage: operation.failureMessage,
    failureStatusCode: operation.failureStatusCode,
    recoveryReference: operation.recoveryReference,
    submittingAt: operation.submittingAt,
    pendingAt: operation.pendingAt,
    pendingVerificationAt: operation.pendingVerificationAt,
    unknownAt: operation.unknownAt,
    manualReviewAt: operation.manualReviewAt,
    failedAt: operation.failedAt,
    cancelledAt: operation.cancelledAt,
    providerReferences: [],
    replayed: false,
    transitionReplayed: false,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    version: operation.version,
  };
}

function makeService() {
  const operation = makeOperation();
  const operations = new FakeOperationRepository(operation);
  const references = new FakeReferenceRepository();
  const manager = new FakeManager(operations, references);
  const idempotency = new FakeIdempotencyService();
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const operationService = {
    get: jest.fn().mockImplementation(() => Promise.resolve(makeView(operation))),
    getInTransaction: jest.fn().mockImplementation(() => Promise.resolve(makeView(operation))),
  };
  const circuitBreaker = new PartnerCircuitBreakerService(
    new ConfigService({
      A6_PARTNER_CIRCUIT_FAILURE_THRESHOLD: 2,
      A6_PARTNER_CIRCUIT_OPEN_SECONDS: 1,
    }),
  );
  const service = new ExternalOperationLifecycleService(
    operations as never,
    references as never,
    new FakeDataSource(manager) as never,
    operationService as never,
    idempotency as never,
    auditService as never,
    circuitBreaker,
    new UnavailableExternalOperationStatusVerifier(),
  );
  return { service, operation, operations, idempotency, circuitBreaker, operationService };
}

function context(suffix = '1') {
  return {
    requestId: `request-${suffix}`,
    correlationId: 'correlation-1',
    traceId: `trace-${suffix}`,
  };
}

describe('ExternalOperationLifecycleService', () => {
  it('progresses from CREATED through submitting and provider-pending without settlement', async () => {
    const fixture = makeService();

    const submitting = await fixture.service.beginAttempt(OPERATION_ID, 'attempt-1', context());
    const pending = await fixture.service.markProviderAccepted(
      OPERATION_ID,
      'ACCEPTED',
      'accepted-1',
      context('2'),
      submitting.version,
    );

    expect(submitting.lifecycleState).toBe(ExternalOperationLifecycleState.SUBMITTING);
    expect(submitting.attemptCount).toBe(1);
    expect(pending.lifecycleState).toBe(ExternalOperationLifecycleState.PENDING_PROVIDER);
    expect(pending.providerStatus).toBe('ACCEPTED');
    expect(pending.failedAt).toBeNull();
  });

  it('converts a timeout into a deterministic UNKNOWN recovery state', async () => {
    const fixture = makeService();
    const submitting = await fixture.service.beginAttempt(OPERATION_ID, 'attempt-1', context());

    const unknown = await fixture.service.markTimeout(
      OPERATION_ID,
      'timeout-1',
      context('2'),
      submitting.version,
    );

    expect(unknown.lifecycleState).toBe(ExternalOperationLifecycleState.UNKNOWN);
    expect(unknown.failureCode).toBe('TIMEOUT_AFTER_SEND_UNKNOWN');
    expect(unknown.recoveryReference).toMatch(/^external-operation-recovery:[a-f0-9]{64}$/);
    expect(unknown.attemptCount).toBe(1);
  });

  it('bounds retries and marks retry exhaustion as FAILED', async () => {
    const fixture = makeService();
    let state = await fixture.service.beginAttempt(OPERATION_ID, 'attempt-1', context());
    state = await fixture.service.markProviderAccepted(
      OPERATION_ID,
      'PENDING',
      'accepted-1',
      context('2'),
      state.version,
    );
    state = await fixture.service.recover({
      externalOperationId: OPERATION_ID,
      nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
      idempotencyKey: 'verify-1',
      requestContext: context('3'),
      expectedVersion: state.version,
    });
    state = await fixture.service.beginAttempt(
      OPERATION_ID,
      'attempt-2',
      context('4'),
      state.version,
    );
    state = await fixture.service.markProviderAccepted(
      OPERATION_ID,
      'PENDING',
      'accepted-2',
      context('5'),
      state.version,
    );
    state = await fixture.service.recover({
      externalOperationId: OPERATION_ID,
      nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
      idempotencyKey: 'verify-2',
      requestContext: context('6'),
      expectedVersion: state.version,
    });
    state = await fixture.service.beginAttempt(
      OPERATION_ID,
      'attempt-3',
      context('7'),
      state.version,
    );
    state = await fixture.service.markProviderAccepted(
      OPERATION_ID,
      'PENDING',
      'accepted-3',
      context('8'),
      state.version,
    );
    state = await fixture.service.recover({
      externalOperationId: OPERATION_ID,
      nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
      idempotencyKey: 'verify-3',
      requestContext: context('9'),
      expectedVersion: state.version,
    });

    const exhausted = await fixture.service.beginAttempt(
      OPERATION_ID,
      'attempt-4',
      context('10'),
      state.version,
    );

    expect(exhausted.lifecycleState).toBe(ExternalOperationLifecycleState.FAILED);
    expect(exhausted.failureCode).toBe('RETRY_EXHAUSTED');
    expect(exhausted.attemptCount).toBe(3);
  });

  it('replays a lifecycle transition deterministically', async () => {
    const fixture = makeService();
    const first = await fixture.service.transition({
      externalOperationId: OPERATION_ID,
      nextState: ExternalOperationLifecycleState.SUBMITTING,
      idempotencyKey: 'same-transition',
      requestContext: context(),
    });
    const replay = await fixture.service.transition({
      externalOperationId: OPERATION_ID,
      nextState: ExternalOperationLifecycleState.SUBMITTING,
      idempotencyKey: 'same-transition',
      requestContext: context('2'),
    });

    expect(replay.transitionReplayed).toBe(true);
    expect(replay.lifecycleState).toBe(first.lifecycleState);
    expect(replay.attemptCount).toBe(first.attemptCount);
  });

  it('rejects a stale lifecycle version', async () => {
    const fixture = makeService();
    await fixture.service.transition({
      externalOperationId: OPERATION_ID,
      nextState: ExternalOperationLifecycleState.SUBMITTING,
      idempotencyKey: 'versioned-transition',
      requestContext: context(),
    });

    await expect(
      fixture.service.transition({
        externalOperationId: OPERATION_ID,
        nextState: ExternalOperationLifecycleState.PENDING_PROVIDER,
        idempotencyKey: 'stale-transition',
        requestContext: context('2'),
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'STALE_LIFECYCLE_VERSION' });
  });

  it('replays duplicate recovery and rejects a changed recovery reference', async () => {
    const fixture = makeService();
    const submitting = await fixture.service.beginAttempt(OPERATION_ID, 'attempt-1', context());
    const unknown = await fixture.service.markTimeout(
      OPERATION_ID,
      'timeout-1',
      context('2'),
      submitting.version,
    );
    const recovery = await fixture.service.recover({
      externalOperationId: OPERATION_ID,
      nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
      idempotencyKey: 'recovery-1',
      requestContext: context('2'),
      expectedVersion: unknown.version,
      recoveryReference: unknown.recoveryReference,
    });
    const replay = await fixture.service.recover({
      externalOperationId: OPERATION_ID,
      nextState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
      idempotencyKey: 'recovery-1',
      requestContext: context('3'),
      expectedVersion: recovery.version - 1,
      recoveryReference: unknown.recoveryReference,
    });

    expect(recovery.lifecycleState).toBe(ExternalOperationLifecycleState.PENDING_VERIFICATION);
    expect(replay.transitionReplayed).toBe(true);
    expect(replay.recoveryReference).toBe(unknown.recoveryReference);
  });

  it('exposes status verification as an abstraction without provider communication', async () => {
    const fixture = makeService();

    const verification = await fixture.service.verifyStatus(OPERATION_ID, context());

    expect(verification).toMatchObject({
      state: 'UNAVAILABLE',
      reasonCode: 'STATUS_VERIFICATION_NOT_CONFIGURED',
    });
    expect(fixture.operationService.get).toHaveBeenCalledWith(OPERATION_ID);
  });
});

describe('PartnerCircuitBreakerService', () => {
  it('opens after the threshold, blocks attempts, and permits a half-open probe after the window', () => {
    const service = new PartnerCircuitBreakerService(
      new ConfigService({
        A6_PARTNER_CIRCUIT_FAILURE_THRESHOLD: 2,
        A6_PARTNER_CIRCUIT_OPEN_SECONDS: 1,
      }),
    );

    expect(service.allowAttempt('NIBSS_NIP', 1_000)).toBe(true);
    service.recordFailure('NIBSS_NIP', 1_000);
    service.recordFailure('NIBSS_NIP', 1_001);
    expect(service.get('NIBSS_NIP', 1_500).state).toBe('OPEN');
    expect(service.allowAttempt('NIBSS_NIP', 1_500)).toBe(false);
    expect(service.allowAttempt('NIBSS_NIP', 2_002)).toBe(true);
    expect(service.get('NIBSS_NIP', 2_002).state).toBe('HALF_OPEN');
    expect(service.recordSuccess('NIBSS_NIP').state).toBe('CLOSED');
    expect(service.allowAttempt('NIBSS_NIP', 2_003)).toBe(true);
  });
});
