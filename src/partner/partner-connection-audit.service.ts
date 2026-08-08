import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import type { PartnerConnectionAuditEvent } from './partner-connection.types';

const A6_PARTNER_CONNECTION_AUDIT_ENTITY_ID = '00000000-0000-4000-8000-000000000047';

@Injectable()
export class PartnerConnectionAuditService {
  constructor(private readonly auditService: AuditService) {}

  async record(manager: EntityManager, event: PartnerConnectionAuditEvent): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'A6_PARTNER_CONNECTION',
      entityId: A6_PARTNER_CONNECTION_AUDIT_ENTITY_ID,
      action: event.action,
      actor: 'a6-partner-boundary',
      correlationId: event.correlationId,
      requestId: event.requestId,
      newValues: {
        partnerKey: event.partnerKey,
        capabilityKey: event.capabilityKey,
        operationType: event.operationType,
        environment: event.environment,
        status: event.status,
        adapterVersion: event.adapterVersion,
        apiVersion: event.apiVersion,
        ...(event.failureCode ? { failureCode: event.failureCode } : {}),
      },
    });
  }
}
