import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { redactRecord } from '../common/sensitive-data-redaction';
import { AuditEvent } from './audit-event.entity';
import type { AuditEventCommand, AuditQuery, AuditView } from './operations.types';

const ALLOW_NOTIFICATION_PROVIDER_AUDIT = Symbol('ALLOW_NOTIFICATION_PROVIDER_AUDIT');

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
      previousValues: command.previousValues ? redactRecord(command.previousValues) : null,
      newValues: command.newValues ? redactRecord(command.newValues) : null,
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
    const includeNotificationProviderRecords = Boolean(
      (query as Record<symbol, unknown>)[ALLOW_NOTIFICATION_PROVIDER_AUDIT],
    );
    if (!includeNotificationProviderRecords) {
      // Restrict operational provider configuration & test-send audit metadata (key fingerprints,
      // sender configuration, base URLs, verification/test error codes, masked test destinations,
      // and maker-checker approval records/comments tied to NOTIFICATION_PROVIDER_CONFIG_PROPOSAL)
      // unless the caller holds `notification.provider.view`.
      // Records remain intact in `audit_events` for authorized oversight.
      builder.andWhere('audit.entity_type NOT IN (:...providerAuditTypes)', {
        providerAuditTypes: ['NOTIFICATION_PROVIDER_CONFIG', 'NOTIFICATION_TEST_SEND'],
      });
      builder.andWhere(
        `NOT (
          audit.entity_type = :providerApprovalEntityType
          AND (
            audit.new_values ->> 'resourceType' = :providerProposalResourceType
            OR EXISTS (
              SELECT 1
                FROM privileged_action_approvals paa
               WHERE paa.id = audit.entity_id
                 AND paa.resource_type = :providerProposalResourceType
            )
          )
        )`,
        {
          providerApprovalEntityType: 'PRIVILEGED_ACTION_APPROVAL',
          providerProposalResourceType: 'NOTIFICATION_PROVIDER_CONFIG_PROPOSAL',
        },
      );
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

  /**
   * Internal oversight read path used only after server-side `notification.provider.view`
   * authorization has succeeded. Delegates through `list(...)` so all other category filters
   * (such as compliance-case restrictions) remain enforced.
   */
  async listWithNotificationProviderOversight(query: AuditQuery = {}): Promise<AuditView[]> {
    const scopedQuery = Object.assign({}, query, {
      [ALLOW_NOTIFICATION_PROVIDER_AUDIT]: true,
    });
    return this.list(scopedQuery);
  }
}
