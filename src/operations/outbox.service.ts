import { randomUUID } from 'node:crypto';

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { redactRecord } from '../common/sensitive-data-redaction';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxEventStatus } from './operations.enums';
import type { OutboxEventCommand, OutboxQuery, OutboxView } from './operations.types';

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
      correlationId: command.correlationId ?? null,
      causationId: command.causationId ?? null,
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
    const repository = manager.getRepository(OutboxEvent);
    const existing = await repository.findOne({ where: { eventKey } });
    if (existing) {
      this.assertSameEvent(existing, command);
      return existing;
    }

    return this.enqueue(manager, {
      ...command,
      eventKey,
    });
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
    event.lastError = errorMessage.slice(0, 255);
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
      existing.correlationId !== (command.correlationId ?? null) ||
      existing.causationId !== (command.causationId ?? null) ||
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
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventKey: event.eventKey,
      schemaVersion: event.schemaVersion,
      classification: event.classification,
      retentionClass: event.retentionClass,
      occurredAt: event.occurredAt,
      correlationId: event.correlationId,
      causationId: event.causationId,
      payload: event.payload,
      status: event.status,
      attempts: event.attempts,
      availableAt: event.availableAt,
      lastError: event.lastError,
      publishedAt: event.publishedAt,
      createdAt: event.createdAt,
    };
  }
}
