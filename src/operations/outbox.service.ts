import { randomUUID } from 'node:crypto';

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { redactRecord, sanitizeDiagnosticIdentifier } from '../common/sensitive-data-redaction';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxEventStatus } from './operations.enums';
import type { OutboxEventCommand, OutboxQuery, OutboxView } from './operations.types';

// Historical outbox payloads can contain identifiers supplied before current
// write-side rules. Re-mask identifier-shaped fields in the diagnostic projection,
// never in the stored business fact used by other consumers.
function diagnosticOutboxPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const safe = redactRecord(payload); // bounded depth/node traversal and secret-key redaction
  const identifierField =
    /(?:id|key|reference|phone|email|contact|destination|nin|bvn|accountnumber|actor|author)$/i;
  const visit = (value: unknown, key = '', identifierContext = false): unknown => {
    const isIdentifier = identifierContext || identifierField.test(key.replace(/[_-]/g, ''));
    if (typeof value === 'string') {
      return isIdentifier ? (sanitizeDiagnosticIdentifier(value) ?? '[REDACTED]') : value;
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, '', isIdentifier));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [
          childKey,
          visit(child, childKey, isIdentifier),
        ]),
      );
    }
    return value;
  };
  return visit(safe) as Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repository: Repository<OutboxEvent>,
  ) {}

  async enqueue(manager: EntityManager, command: OutboxEventCommand): Promise<OutboxEvent> {
    const event = manager.getRepository(OutboxEvent).create({
      id: randomUUID(),
      eventType: command.eventType,
      aggregateType: command.aggregateType,
      aggregateId: command.aggregateId,
      eventKey: command.eventKey ?? null,
      schemaVersion: command.schemaVersion ?? 1,
      classification: command.classification ?? 'INTERNAL_OPERATIONS',
      retentionClass: command.retentionClass ?? 'OPERATIONS_DEFAULT',
      occurredAt: command.occurredAt ?? new Date(),
      // Report 26 (N-02): caller-supplied correlation ids are bounded and
      // redacted deterministically before persistence; legitimate ids are
      // preserved byte-for-byte.
      correlationId: sanitizeDiagnosticIdentifier(command.correlationId) ?? null,
      causationId: sanitizeDiagnosticIdentifier(command.causationId) ?? null,
      payload: redactRecord(command.payload),
      status: OutboxEventStatus.PENDING,
      attempts: 0,
      availableAt: command.availableAt ?? new Date(),
      lastError: null,
      publishedAt: null,
    });
    return manager.getRepository(OutboxEvent).save(event);
  }

  async enqueueOnce(
    manager: EntityManager,
    command: OutboxEventCommand & { eventKey: string },
  ): Promise<OutboxEvent> {
    const eventKey = command.eventKey.trim();
    if (!eventKey || eventKey.length > 180) {
      throw new ConflictException('Outbox eventKey is invalid');
    }
    // Report 26 (N-02): normalize the correlation id ONCE up front so the
    // deduplication comparison (assertSameEvent) and the stored row always use
    // the same deterministic value — an identical retry can never produce a
    // false "event key reused" conflict, and legitimate ids compare unchanged.
    const normalizedCommand: OutboxEventCommand & { eventKey: string } = {
      ...command,
      eventKey,
      correlationId: sanitizeDiagnosticIdentifier(command.correlationId),
      causationId: sanitizeDiagnosticIdentifier(command.causationId),
    };
    const repository = manager.getRepository(OutboxEvent);
    const existing = await repository.findOne({ where: { eventKey } });
    if (existing) {
      this.assertSameEvent(existing, normalizedCommand);
      return existing;
    }

    return this.enqueue(manager, normalizedCommand);
  }

  async list(query: OutboxQuery = {}): Promise<OutboxView[]> {
    const take = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const events = await this.repository.find({
      where: query.status ? { status: query.status } : undefined,
      order: { createdAt: 'DESC', id: 'DESC' },
      take,
    });
    return events.map((event) => this.toView(event));
  }

  async claimPending(manager: EntityManager, limit = 100): Promise<OutboxEvent[]> {
    const events = await manager
      .getRepository(OutboxEvent)
      .createQueryBuilder('outbox')
      .where('outbox.status = :status AND outbox.available_at <= NOW()', {
        status: OutboxEventStatus.PENDING,
      })
      .orderBy('outbox.created_at', 'ASC')
      .take(Math.min(Math.max(limit, 1), 1000))
      .setLock('pessimistic_write')
      .getMany();
    for (const event of events) {
      event.attempts += 1;
      await manager.getRepository(OutboxEvent).save(event);
    }
    return events;
  }

  async markPublished(manager: EntityManager, eventId: string): Promise<void> {
    const event = await manager.getRepository(OutboxEvent).findOne({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException(`Outbox event ${eventId} was not found`);
    }
    event.status = OutboxEventStatus.PUBLISHED;
    event.publishedAt = new Date();
    event.lastError = null;
    await manager.getRepository(OutboxEvent).save(event);
  }

  async markFailed(
    manager: EntityManager,
    eventId: string,
    errorMessage: string,
    retryDelaySeconds = 60,
  ): Promise<void> {
    const event = await manager.getRepository(OutboxEvent).findOne({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException(`Outbox event ${eventId} was not found`);
    }
    event.status = OutboxEventStatus.FAILED;
    event.lastError = sanitizeDiagnosticIdentifier(errorMessage) ?? '[REDACTED]';
    event.availableAt = new Date(Date.now() + Math.max(retryDelaySeconds, 1) * 1000);
    await manager.getRepository(OutboxEvent).save(event);
  }

  async retryFailed(manager: EntityManager, limit = 100): Promise<number> {
    const events = await manager
      .getRepository(OutboxEvent)
      .createQueryBuilder('outbox')
      .where('outbox.status = :status AND outbox.available_at <= NOW()', {
        status: OutboxEventStatus.FAILED,
      })
      .orderBy('outbox.available_at', 'ASC')
      .take(Math.min(Math.max(limit, 1), 1000))
      .setLock('pessimistic_write')
      .getMany();
    for (const event of events) {
      event.status = OutboxEventStatus.PENDING;
      await manager.getRepository(OutboxEvent).save(event);
    }
    return events.length;
  }

  private assertSameEvent(
    existing: OutboxEvent,
    command: OutboxEventCommand & { eventKey: string },
  ): void {
    if (
      existing.eventType !== command.eventType ||
      existing.aggregateType !== command.aggregateType ||
      existing.aggregateId !== command.aggregateId ||
      existing.schemaVersion !== (command.schemaVersion ?? 1) ||
      existing.classification !== (command.classification ?? 'INTERNAL_OPERATIONS') ||
      existing.retentionClass !== (command.retentionClass ?? 'OPERATIONS_DEFAULT') ||
      (command.occurredAt !== undefined &&
        existing.occurredAt.getTime() !== command.occurredAt.getTime()) ||
      (sanitizeDiagnosticIdentifier(existing.correlationId) ?? null) !==
        (command.correlationId ?? null) ||
      (sanitizeDiagnosticIdentifier(existing.causationId) ?? null) !==
        (command.causationId ?? null) ||
      this.canonicalJson(existing.payload) !== this.canonicalJson(redactRecord(command.payload))
    ) {
      throw new ConflictException('The outbox event key was reused for a different event');
    }
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`)
      .join(',')}}`;
  }

  private toView(event: OutboxEvent): OutboxView {
    return {
      id: event.id,
      eventType: sanitizeDiagnosticIdentifier(event.eventType) ?? '[REDACTED]',
      aggregateType: sanitizeDiagnosticIdentifier(event.aggregateType) ?? '[REDACTED]',
      aggregateId: sanitizeDiagnosticIdentifier(event.aggregateId) ?? '[REDACTED]',
      // Read-boundary masking does not alter the event key used for idempotency.
      eventKey: sanitizeDiagnosticIdentifier(event.eventKey) ?? null,
      schemaVersion: event.schemaVersion,
      classification: event.classification,
      retentionClass: event.retentionClass,
      occurredAt: event.occurredAt,
      // Report 26 (row 15): read-boundary protection for rows persisted before
      // the write-side sanitization existed.
      correlationId: sanitizeDiagnosticIdentifier(event.correlationId) ?? null,
      causationId: sanitizeDiagnosticIdentifier(event.causationId) ?? null,
      payload: diagnosticOutboxPayload(event.payload),
      status: event.status,
      attempts: event.attempts,
      availableAt: event.availableAt,
      lastError: sanitizeDiagnosticIdentifier(event.lastError) ?? null,
      publishedAt: event.publishedAt,
      createdAt: event.createdAt,
    };
  }
}
