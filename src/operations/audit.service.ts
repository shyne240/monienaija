import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { redactRecord } from '../common/sensitive-data-redaction';
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
      previousValues: command.previousValues ? redactRecord(command.previousValues) : null,
      newValues: command.newValues ? redactRecord(command.newValues) : null,
      occurredAt: command.occurredAt ?? new Date(),
    });
    return manager.getRepository(AuditEvent).save(event);
  }

  async list(
    query: AuditQuery = {},
    options: { includeComplianceCaseRecords?: boolean } = {},
  ): Promise<AuditView[]> {
    const take = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const builder = this.repository.createQueryBuilder('audit');
    if (!options.includeComplianceCaseRecords) {
      // Generic audit views are not category- or subject-scoped. Hide case events and both
      // current and legacy case-route authorization decisions by default until a dedicated,
      // approved audit-access policy exists. Records remain intact in the database. Only
      // explicitly trusted internal consumers may opt in; never derive this option from a request.
      builder.andWhere('audit.entity_type NOT IN (:...caseTypes)', {
        caseTypes: [
          'CUSTOMER_COMPLIANCE_CASE',
          'COMPLIANCE_CASE_COMMENT',
          'COMPLIANCE_CASE_EVIDENCE',
          'COMPLIANCE_CASE_ASSIGNMENT',
          'COMPLIANCE_CASE_HISTORY',
        ],
      });
      builder.andWhere(
        `NOT (audit.entity_type = :decisionType AND (
          COALESCE(audit.new_values->>'resourceType', '') = :caseResource OR
          COALESCE(audit.new_values->>'action', '') ILIKE :legacyCasePath
        ))`,
        {
          decisionType: 'AUTHORIZATION_DECISION',
          caseResource: 'customer-compliance-case',
          legacyCasePath: '%/compliance-cases%',
        },
      );
      // A4 and A7 policy audit facts can include customerId and reason codes such as
      // COMPLIANCE_CASE_OPEN or COMPLIANCE_REVIEW_OPEN. Those reveal a case's existence even
      // without its ID. Fail closed for compliance-prefixed reasons, including future codes;
      // other policy audit facts remain visible. Malformed reason-code values are hidden
      // rather than accidentally disclosing a restricted reason in an unexpected shape.
      builder.andWhere(
        `NOT (audit.entity_type = :policyDecisionType AND (
          (audit.new_values #> '{metadata,reasonCodes}' IS NOT NULL AND
           jsonb_typeof(audit.new_values #> '{metadata,reasonCodes}') <> 'array') OR
          EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(audit.new_values #> '{metadata,reasonCodes}') = 'array'
                THEN audit.new_values #> '{metadata,reasonCodes}' ELSE '[]'::jsonb END
            ) AS reasons(code)
            WHERE jsonb_typeof(reasons.code) <> 'string'
               OR left(reasons.code #>> '{}', 11) = 'COMPLIANCE_'
          )
        ))`,
        { policyDecisionType: 'A4_POLICY_DECISION' },
      );
    }
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
