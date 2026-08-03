import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { AuditEvent } from './audit-event.entity';
import type { AuditEventCommand, AuditQuery, AuditView } from './operations.types';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditEvent)
    private readonly repository: Repository<AuditEvent>,
  ) {}

  async record(manager: EntityManager, command: AuditEventCommand): Promise<AuditEvent> {
    const event = manager.getRepository(AuditEvent).create({
      id: randomUUID(),
      entityType: command.entityType,
      entityId: command.entityId,
      action: command.action,
      actor: command.actor,
      correlationId: command.correlationId ?? null,
      requestId: command.requestId ?? null,
      previousValues: command.previousValues ?? null,
      newValues: command.newValues ?? null,
      occurredAt: command.occurredAt ?? new Date(),
    });
    return manager.getRepository(AuditEvent).save(event);
  }

  async list(query: AuditQuery = {}): Promise<AuditView[]> {
    const take = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const builder = this.repository.createQueryBuilder('audit');
    if (query.entityType) {
      builder.andWhere('audit.entity_type = :entityType', { entityType: query.entityType });
    }
    if (query.entityId) {
      builder.andWhere('audit.entity_id = :entityId', { entityId: query.entityId });
    }
    if (query.correlationId) {
      builder.andWhere('audit.correlation_id = :correlationId', {
        correlationId: query.correlationId,
      });
    }
    const events = await builder.orderBy('audit.occurred_at', 'DESC').take(take).getMany();
    return events.map((event) => ({
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      actor: event.actor,
      correlationId: event.correlationId,
      requestId: event.requestId,
      previousValues: event.previousValues,
      newValues: event.newValues,
      occurredAt: event.occurredAt,
    }));
  }
}
