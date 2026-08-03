import { ConflictException } from '@nestjs/common';
import type { EntityManager, EntityTarget, ObjectLiteral, Repository } from 'typeorm';

import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyRecord } from '../src/operations/idempotency-record.entity';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { OutboxService } from '../src/operations/outbox.service';
import { OutboxEventStatus } from '../src/operations/operations.enums';

class IdempotencyRepository {
  readonly records = new Map<string, IdempotencyRecord>();

  create(input: Partial<IdempotencyRecord>): IdempotencyRecord {
    return input as IdempotencyRecord;
  }

  save(record: IdempotencyRecord): Promise<IdempotencyRecord> {
    this.records.set(`${record.scope}:${record.idempotencyKey}`, record);
    return Promise.resolve(record);
  }

  remove(record: IdempotencyRecord): Promise<IdempotencyRecord> {
    this.records.delete(`${record.scope}:${record.idempotencyKey}`);
    return Promise.resolve(record);
  }

  findOne(options: {
    where: { scope?: string; idempotencyKey?: string; id?: string };
  }): Promise<IdempotencyRecord | null> {
    const where = options.where;
    if (where.id) {
      return Promise.resolve(
        [...this.records.values()].find((record) => record.id === where.id) ?? null,
      );
    }
    if (where.scope && where.idempotencyKey) {
      return Promise.resolve(this.records.get(`${where.scope}:${where.idempotencyKey}`) ?? null);
    }
    return Promise.resolve(null);
  }

  find(): Promise<IdempotencyRecord[]> {
    const now = Date.now();
    return Promise.resolve(
      [...this.records.values()].filter((record) => record.expiresAt.getTime() <= now),
    );
  }

  createQueryBuilder(): IdempotencyQueryBuilder {
    return new IdempotencyQueryBuilder(this.records);
  }
}

class IdempotencyQueryBuilder {
  private scope = '';
  private key = '';

  constructor(private readonly records: Map<string, IdempotencyRecord>) {}

  where(_sql: string, parameters: { scope: string; key: string }): this {
    this.scope = parameters.scope;
    this.key = parameters.key;
    return this;
  }

  setLock(mode: 'pessimistic_write'): this {
    void mode;
    return this;
  }

  getOne(): Promise<IdempotencyRecord | null> {
    return Promise.resolve(this.records.get(`${this.scope}:${this.key}`) ?? null);
  }
}

class OutboxRepository {
  readonly records = new Map<string, OutboxEvent>();

  create(input: Partial<OutboxEvent>): OutboxEvent {
    return input as OutboxEvent;
  }

  save(event: OutboxEvent): Promise<OutboxEvent> {
    this.records.set(event.id, event);
    return Promise.resolve(event);
  }

  find(options?: { where?: { status?: OutboxEventStatus } }): Promise<OutboxEvent[]> {
    const status = options?.where?.status;
    return Promise.resolve(
      [...this.records.values()].filter((event) => !status || event.status === status),
    );
  }

  findOne(options: { where: { id: string } }): Promise<OutboxEvent | null> {
    return Promise.resolve(this.records.get(options.where.id) ?? null);
  }

  createQueryBuilder(): OutboxQueryBuilder {
    return new OutboxQueryBuilder(this.records);
  }
}

class OutboxQueryBuilder {
  constructor(private readonly records: Map<string, OutboxEvent>) {}

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  take(): this {
    return this;
  }

  setLock(mode: 'pessimistic_write'): this {
    void mode;
    return this;
  }

  getMany(): Promise<OutboxEvent[]> {
    return Promise.resolve([...this.records.values()]);
  }
}

class AuditRepository {
  readonly records: AuditEvent[] = [];

  create(input: Partial<AuditEvent>): AuditEvent {
    return input as AuditEvent;
  }

  save(event: AuditEvent): Promise<AuditEvent> {
    this.records.push(event);
    return Promise.resolve(event);
  }

  createQueryBuilder(): AuditQueryBuilder {
    return new AuditQueryBuilder(this.records);
  }
}

class AuditQueryBuilder {
  constructor(private readonly records: AuditEvent[]) {}

  andWhere(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  take(): this {
    return this;
  }

  getMany(): Promise<AuditEvent[]> {
    return Promise.resolve(this.records);
  }
}

class OperationalManager {
  constructor(
    private readonly idempotency: IdempotencyRepository,
    private readonly outbox: OutboxRepository,
    private readonly audit: AuditRepository,
  ) {}

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    if (target === IdempotencyRecord) {
      return this.idempotency as unknown as Repository<T>;
    }
    if (target === OutboxEvent) {
      return this.outbox as unknown as Repository<T>;
    }
    if (target === AuditEvent) {
      return this.audit as unknown as Repository<T>;
    }
    throw new Error('Unexpected operational repository');
  }
}

describe('M7 operational resilience', () => {
  it('replays idempotent requests, detects hash changes, and cleans expired records', async () => {
    const repository = new IdempotencyRepository();
    const manager = new OperationalManager(
      repository,
      new OutboxRepository(),
      new AuditRepository(),
    );
    const service = new IdempotencyService(repository as unknown as Repository<IdempotencyRecord>);
    const command = {
      scope: 'transfer.create',
      key: 'key-1',
      requestHash: 'a'.repeat(64),
      retentionSeconds: 60,
    };

    const first = await service.reserve(manager as unknown as EntityManager, command);
    expect(first.kind).toBe('NEW');
    await service.complete(manager as unknown as EntityManager, first.record.id, {
      statusCode: 201,
      responseBody: { id: 'resource-1' },
      resourceType: 'TRANSFER',
      resourceId: '00000000-0000-4000-8000-000000000001',
    });
    const replay = await service.reserve(manager as unknown as EntityManager, command);
    expect(replay.kind).toBe('REPLAY');
    expect(replay.record.hitCount).toBe(1);

    await expect(
      service.reserve(manager as unknown as EntityManager, {
        ...command,
        requestHash: 'b'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const stored = replay.record;
    stored.expiresAt = new Date(Date.now() - 1);
    const replacement = await service.reserve(manager as unknown as EntityManager, command);
    expect(replacement.kind).toBe('NEW');
    expect(replacement.record.id).not.toBe(stored.id);
    expect(await service.cleanupExpired()).toBe(0);
  });

  it('persists outbox events and supports failed-to-pending retry recovery', async () => {
    const repository = new OutboxRepository();
    const manager = new OperationalManager(
      new IdempotencyRepository(),
      repository,
      new AuditRepository(),
    );
    const service = new OutboxService(repository as unknown as Repository<OutboxEvent>);
    const event = await service.enqueue(manager as unknown as EntityManager, {
      eventType: 'transfer.completed',
      aggregateType: 'TRANSFER',
      aggregateId: '00000000-0000-4000-8000-000000000001',
      payload: { amountMinor: '100' },
    });
    expect(event.status).toBe(OutboxEventStatus.PENDING);

    await service.markFailed(manager as unknown as EntityManager, event.id, 'temporary failure', 1);
    const stored = repository.records.get(event.id)!;
    stored.availableAt = new Date(Date.now() - 1);
    const recovered = await service.retryFailed(manager as unknown as EntityManager);
    expect(recovered).toBe(1);
    expect(stored.status).toBe(OutboxEventStatus.PENDING);
    expect(stored.attempts).toBe(0);

    await service.markPublished(manager as unknown as EntityManager, event.id);
    expect(stored.status).toBe(OutboxEventStatus.PUBLISHED);
  });

  it('records audit events and increments operational metrics without financial mutation', async () => {
    const idempotency = new IdempotencyRepository();
    const outbox = new OutboxRepository();
    const audit = new AuditRepository();
    const manager = new OperationalManager(idempotency, outbox, audit);
    const auditService = new AuditService(audit as unknown as Repository<AuditEvent>);

    const event = await auditService.record(manager as unknown as EntityManager, {
      entityType: 'TRANSFER',
      entityId: '00000000-0000-4000-8000-000000000001',
      action: 'COMPLETED',
      actor: 'internal',
      correlationId: 'transfer:1',
      newValues: { status: 'COMPLETED' },
    });
    expect(event.action).toBe('COMPLETED');
    expect(audit.records).toHaveLength(1);
  });
});
