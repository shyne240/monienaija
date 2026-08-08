import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { ExternalOperation } from '../src/partner/external-operation.entity';
import {
  ExternalOperationReferenceSource,
  ExternalOperationReferenceType,
  ExternalOperationResourceType,
} from '../src/partner/external-operation.enums';
import { ExternalOperationReference } from '../src/partner/external-operation-reference.entity';
import { ExternalOperationService } from '../src/partner/external-operation.service';
import { EXTERNAL_OPERATION_IDEMPOTENCY_SCOPE } from '../src/partner/external-operation.types';
import type { CreateExternalOperationCommand } from '../src/partner/external-operation.types';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const WALLET_ID = '00000000-0000-4000-8000-000000000002';
const LEDGER_ID = '00000000-0000-4000-8000-000000000003';
const RESOURCE_ID = '00000000-0000-4000-8000-000000000004';
const COMMAND_ID = '00000000-0000-4000-8000-000000000005';
const TARGET_MAPPING_REFERENCE = `a6-target:${'a'.repeat(64)}`;

class FakeOperationRepository {
  readonly records = new Map<string, ExternalOperation>();

  create(input: Partial<ExternalOperation>): ExternalOperation {
    return input as ExternalOperation;
  }

  save(operation: ExternalOperation): ExternalOperation {
    const now = new Date();
    operation.createdAt ??= now;
    operation.updatedAt = now;
    operation.version ??= 1;
    this.records.set(operation.id, operation);
    return operation;
  }

  findOne(options: { where: { id?: string; internalCommandId?: string } }) {
    if (options.where.id) return this.records.get(options.where.id) ?? null;
    if (options.where.internalCommandId) {
      return (
        [...this.records.values()].find(
          (operation) => operation.internalCommandId === options.where.internalCommandId,
        ) ?? null
      );
    }
    return null;
  }

  createQueryBuilder(): FakeOperationQueryBuilder {
    return new FakeOperationQueryBuilder(this.records);
  }
}

class FakeOperationQueryBuilder {
  private id = '';

  constructor(private readonly records: Map<string, ExternalOperation>) {}

  where(_sql: string, parameters: { externalOperationId: string }): this {
    this.id = parameters.externalOperationId;
    return this;
  }

  setLock(): this {
    return this;
  }

  getOne(): Promise<ExternalOperation | null> {
    return Promise.resolve(this.records.get(this.id) ?? null);
  }
}

class FakeReferenceRepository {
  readonly records = new Map<string, ExternalOperationReference>();

  create(input: Partial<ExternalOperationReference>): ExternalOperationReference {
    return input as ExternalOperationReference;
  }

  save(reference: ExternalOperationReference): ExternalOperationReference {
    const now = new Date();
    reference.createdAt ??= now;
    this.records.set(reference.id, reference);
    return reference;
  }

  findOne(options: {
    where: {
      partnerKey?: string;
      referenceType?: ExternalOperationReferenceType;
      referenceValue?: string;
    };
  }) {
    return (
      [...this.records.values()].find(
        (reference) =>
          reference.partnerKey === options.where.partnerKey &&
          reference.referenceType === options.where.referenceType &&
          reference.referenceValue === options.where.referenceValue,
      ) ?? null
    );
  }

  find(options: { where: { externalOperationId: string } }) {
    return [...this.records.values()].filter(
      (reference) => reference.externalOperationId === options.where.externalOperationId,
    );
  }
}

class FakeManager {
  constructor(
    readonly operations: FakeOperationRepository,
    readonly references: FakeReferenceRepository,
  ) {}

  getRepository(target: unknown) {
    if (target === ExternalOperation) return this.operations;
    if (target === ExternalOperationReference) return this.references;
    throw new Error('Unexpected repository');
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
    {
      id: string;
      scope: string;
      key: string;
      requestHash: string;
      resourceId: string | null;
      status: 'IN_PROGRESS' | 'COMPLETED';
    }
  >();
  private nextId = 1;

  reserve(_manager: EntityManager, command: { scope: string; key: string; requestHash: string }) {
    const key = `${command.scope}:${command.key}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        throw new ConflictException('The idempotency key was already used for another request');
      }
      if (existing.status === 'IN_PROGRESS') {
        throw new ConflictException('The idempotent request is already in progress');
      }
      return { kind: 'REPLAY' as const, record: existing };
    }
    const record = {
      id: `idempotency-${this.nextId++}`,
      scope: command.scope,
      key: command.key,
      requestHash: command.requestHash,
      resourceId: null,
      status: 'IN_PROGRESS' as const,
    };
    this.records.set(key, record);
    return { kind: 'NEW' as const, record };
  }

  complete(_manager: EntityManager, recordId: string, command: { resourceId?: string }) {
    const record = [...this.records.values()].find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('Missing idempotency record');
    record.status = 'COMPLETED';
    record.resourceId = command.resourceId ?? null;
  }
}

function makeCommand(
  overrides: Partial<CreateExternalOperationCommand> = {},
): CreateExternalOperationCommand {
  return {
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
    idempotencyKey: 'operation-key-1',
    requestContext: {
      requestId: 'request-1',
      correlationId: 'correlation-1',
      traceId: 'trace-1',
    },
    causationId: null,
    ...overrides,
  };
}

function makeService() {
  const operations = new FakeOperationRepository();
  const references = new FakeReferenceRepository();
  const manager = new FakeManager(operations, references);
  const idempotency = new FakeIdempotencyService();
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const partnerConnectionService = {
    getProfile: jest.fn().mockReturnValue({
      enabled: true,
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
    }),
  };
  const service = new ExternalOperationService(
    operations as never,
    references as never,
    new FakeDataSource(manager) as never,
    idempotency as never,
    auditService as never,
    partnerConnectionService as never,
  );
  return { service, operations, references, manager, idempotency, auditService };
}

describe('ExternalOperationService', () => {
  it('creates one durable external-operation identity and deterministic provider idempotency reference', async () => {
    const fixture = makeService();

    const result = await fixture.service.create(makeCommand());

    expect(result).toMatchObject({
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
      internalIdempotencyScope: EXTERNAL_OPERATION_IDEMPOTENCY_SCOPE,
      internalIdempotencyKey: 'operation-key-1',
    });
    expect(result.externalOperationReference).toMatch(/^external-operation:v1:[a-f0-9]{64}$/);
    expect(result.providerIdempotencyScope).toBe('nibss.nip.external-operation.v1');
    expect(result.providerIdempotencyKey).toMatch(
      /^nibss\.nip\.external-operation\.v1:[a-f0-9]{64}$/,
    );
    expect(result.providerReferences).toHaveLength(1);
    expect(result.providerReferences[0]).toMatchObject({
      referenceType: ExternalOperationReferenceType.PROVIDER_IDEMPOTENCY,
      referenceValue: result.providerIdempotencyKey,
      source: ExternalOperationReferenceSource.REQUEST,
    });
    expect(result.replayed).toBe(false);
    expect(fixture.auditService.record).toHaveBeenCalled();
  });

  it('derives the same request hash when transport-only context changes', async () => {
    const first = makeService();
    const firstResult = await first.service.create(makeCommand());
    const second = await first.service.create(
      makeCommand({
        requestContext: {
          requestId: 'request-2',
          correlationId: 'correlation-2',
          traceId: 'trace-2',
        },
      }),
    );

    expect(second.replayed).toBe(true);
    expect(second.externalOperationId).toBe(firstResult.externalOperationId);
    expect(second.requestHash).toBe(firstResult.requestHash);
  });

  it('rejects changed payloads under the same Operations idempotency scope', async () => {
    const fixture = makeService();
    await fixture.service.create(makeCommand());

    await expect(
      fixture.service.create(makeCommand({ amountMinor: '2000' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.operations.records.size).toBe(1);
  });

  it('replays the same internal command even when a different idempotency key is supplied', async () => {
    const fixture = makeService();
    const first = await fixture.service.create(makeCommand());
    const replay = await fixture.service.create(makeCommand({ idempotencyKey: 'operation-key-2' }));

    expect(replay.replayed).toBe(true);
    expect(replay.externalOperationId).toBe(first.externalOperationId);
    expect(fixture.operations.records.size).toBe(1);
  });

  it('records provider references durably and replays the same reference', async () => {
    const fixture = makeService();
    const operation = await fixture.service.create(makeCommand());
    const command = {
      externalOperationId: operation.externalOperationId,
      partnerKey: 'NIBSS_NIP' as const,
      referenceType: ExternalOperationReferenceType.OPERATION,
      referenceValue: 'provider-operation-1',
      namespace: 'nibss.nip',
      source: ExternalOperationReferenceSource.ACKNOWLEDGEMENT,
      observedAt: '2026-08-08T00:00:00.000Z',
      requestContext: makeCommand().requestContext,
    };

    const first = await fixture.service.recordProviderReference(command);
    const replay = await fixture.service.recordProviderReference(command);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.reference.id).toBe(first.reference.id);
    expect(fixture.references.records.size).toBe(2);
  });

  it('rejects a provider reference mapped to a different operation', async () => {
    const fixture = makeService();
    const first = await fixture.service.create(makeCommand());
    const second = await fixture.service.create(
      makeCommand({
        internalCommandId: '00000000-0000-4000-8000-000000000010',
        idempotencyKey: 'operation-key-2',
        resourceId: '00000000-0000-4000-8000-000000000011',
      }),
    );
    const reference = {
      externalOperationId: first.externalOperationId,
      partnerKey: 'NIBSS_NIP' as const,
      referenceType: ExternalOperationReferenceType.TRANSACTION,
      referenceValue: 'provider-transaction-1',
      namespace: 'nibss.nip',
      source: ExternalOperationReferenceSource.ACKNOWLEDGEMENT,
      requestContext: makeCommand().requestContext,
    };
    await fixture.service.recordProviderReference(reference);

    await expect(
      fixture.service.recordProviderReference({
        ...reference,
        externalOperationId: second.externalOperationId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps provider identities separate from internal operation identities', async () => {
    const fixture = makeService();
    const operation = await fixture.service.create(makeCommand());

    expect(operation.externalOperationId).not.toBe(operation.internalCommandId);
    expect(operation.externalOperationReference).not.toBe(operation.providerIdempotencyKey);
    expect(operation.providerIdempotencyKey).not.toBe(operation.internalIdempotencyKey);
    expect(operation.providerReferences[0]?.referenceValue).not.toBe(operation.externalOperationId);
  });
});
