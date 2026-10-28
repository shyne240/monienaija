import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { redactRecord } from '../common/sensitive-data-redaction';
import {
  normalizeProviderErrorCode,
  sanitizeProviderRefForBoundary,
} from '../notification/provider-security';
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
        providerAuditTypes: [
          'NOTIFICATION_PROVIDER_CONFIG',
          'NOTIFICATION_TEST_SEND',
          'NOTIFICATION_TEST_SEND_QUOTA',
        ],
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
      previousValues: sanitizeNotificationProviderAuditPayload(
        event.entityType,
        event.previousValues,
      ),
      newValues: sanitizeNotificationProviderAuditPayload(event.entityType, event.newValues),
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

function sanitizeNotificationProviderAuditPayload(
  entityType: string,
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  if (
    entityType !== 'NOTIFICATION_TEST_SEND' &&
    entityType !== 'NOTIFICATION_PROVIDER_CONFIG'
  ) {
    return payload;
  }

  const hasDiagnosticField =
    'providerRef' in payload ||
    'lastTestProviderRef' in payload ||
    'errorCode' in payload ||
    'lastTestErrorCode' in payload ||
    'lastVerificationError' in payload;
  if (!hasDiagnosticField) {
    return payload;
  }

  const sanitized: Record<string, unknown> = { ...payload };
  const providerHint = payload['provider'];

  if ('providerRef' in sanitized) {
    sanitized['providerRef'] = sanitizeProviderRefForBoundary(
      sanitized['providerRef'],
      providerHint,
    );
  }
  if ('lastTestProviderRef' in sanitized) {
    sanitized['lastTestProviderRef'] = sanitizeProviderRefForBoundary(
      sanitized['lastTestProviderRef'],
      providerHint,
    );
  }
  if (
    'errorCode' in sanitized &&
    sanitized['errorCode'] !== null &&
    sanitized['errorCode'] !== undefined
  ) {
    sanitized['errorCode'] = normalizeProviderErrorCode(sanitized['errorCode']);
  }
  if (
    'lastTestErrorCode' in sanitized &&
    sanitized['lastTestErrorCode'] !== null &&
    sanitized['lastTestErrorCode'] !== undefined
  ) {
    sanitized['lastTestErrorCode'] = normalizeProviderErrorCode(sanitized['lastTestErrorCode']);
  }
  if (
    'lastVerificationError' in sanitized &&
    sanitized['lastVerificationError'] !== null &&
    sanitized['lastVerificationError'] !== undefined
  ) {
    sanitized['lastVerificationError'] = normalizeProviderErrorCode(
      sanitized['lastVerificationError'],
    );
  }

  return sanitized;
}
