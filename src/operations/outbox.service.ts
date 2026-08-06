import { randomUUID } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
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
      payload: redactRecord(command.payload),
      status: OutboxEventStatus.PENDING,
      attempts: 0,
      availableAt: command.availableAt ?? new Date(),
      lastError: null,
      publishedAt: null,
    });
    return manager.getRepository(OutboxEvent).save(event);
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

  private toView(event: OutboxEvent): OutboxView {
    return {
      id: event.id,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
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
