import { ConflictException } from '@nestjs/common';
import type {
  DeepPartial,
  EntityManager,
  FindOneOptions,
  ObjectLiteral,
  Repository,
} from 'typeorm';

import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { OutboxService } from '../src/operations/outbox.service';
import type { OutboxEventCommand } from '../src/operations/operations.types';

const EVENT_KEY = 'transfer.completed:00000000-0000-4000-8000-000000000001:v1';
const AGGREGATE_ID = '00000000-0000-4000-8000-000000000001';

class InMemoryOutboxRepository {
  readonly records = new Map<string, OutboxEvent>();
  private sequence = 0;

  create(input: DeepPartial<OutboxEvent>): OutboxEvent {
    this.sequence += 1;
    return Object.assign(new OutboxEvent(), {
      id: `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`,
      createdAt: new Date(1_000 + this.sequence),
      ...input,
    });
  }

  save(event: OutboxEvent): Promise<OutboxEvent> {
    this.records.set(event.id, event);
    return Promise.resolve(event);
  }

  findOne(options: FindOneOptions<OutboxEvent>): Promise<OutboxEvent | null> {
    const where = options.where;
    if (!where || Array.isArray(where)) return Promise.resolve(null);
    if (typeof where.eventKey === 'string') {
      return Promise.resolve(
        [...this.records.values()].find((event) => event.eventKey === where.eventKey) ?? null,
      );
    }
    return Promise.resolve(null);
  }
}

class InMemoryManager {
  constructor(private readonly repository: InMemoryOutboxRepository) {}

  getRepository<T extends ObjectLiteral>(): Repository<T> {
    return this.repository as unknown as Repository<T>;
  }
}

function makeCommand(overrides: Partial<OutboxEventCommand> = {}): OutboxEventCommand & {
  eventKey: string;
} {
  return {
    eventKey: EVENT_KEY,
    eventType: 'transfer.completed',
    aggregateType: 'TRANSFER',
    aggregateId: AGGREGATE_ID,
    schemaVersion: 1,
    classification: 'RESTRICTED_FINANCIAL',
    retentionClass: 'A5_TRANSFER_EVENT',
    occurredAt: new Date('2026-08-07T10:00:00.000Z'),
    correlationId: 'correlation-transfer-1',
    causationId: undefined,
    payload: {
      eventKey: EVENT_KEY,
      eventType: 'transfer.completed',
      schemaVersion: 1,
      aggregateType: 'TRANSFER',
      aggregateId: AGGREGATE_ID,
      transferId: AGGREGATE_ID,
      commandId: '00000000-0000-4000-8000-000000000002',
      amountMinor: '10000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      journalId: '00000000-0000-4000-8000-000000000003',
    },
    ...overrides,
  };
}

describe('OutboxService transactional event contract', () => {
  it('creates one durable event for an event key and replays the same fact', async () => {
    const repository = new InMemoryOutboxRepository();
    const manager = new InMemoryManager(repository);
    const service = new OutboxService(repository as unknown as Repository<OutboxEvent>);
    const command = makeCommand();

    const first = await service.enqueueOnce(manager as unknown as EntityManager, command);
    const second = await service.enqueueOnce(manager as unknown as EntityManager, command);

    expect(second.id).toBe(first.id);
    expect(repository.records.size).toBe(1);
    expect(first.eventType).toBe('transfer.completed');
    expect(first.schemaVersion).toBe(1);
    expect(first.payload).toMatchObject({
      transferId: AGGREGATE_ID,
      journalId: '00000000-0000-4000-8000-000000000003',
      amountMinor: '10000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
  });

  it('rejects reuse of an event key with changed immutable payload', async () => {
    const repository = new InMemoryOutboxRepository();
    const manager = new InMemoryManager(repository);
    const service = new OutboxService(repository as unknown as Repository<OutboxEvent>);
    await service.enqueueOnce(manager as unknown as EntityManager, makeCommand());

    await expect(
      service.enqueueOnce(
        manager as unknown as EntityManager,
        makeCommand({ payload: { eventType: 'transfer.completed', amountMinor: '20000' } }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.records.size).toBe(1);
  });
});
