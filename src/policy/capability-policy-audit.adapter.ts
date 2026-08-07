import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import type { PolicyAuditFact, PolicyAuditPort } from './capability-policy.types';

@Injectable()
export class TypeOrmPolicyAuditAdapter implements PolicyAuditPort {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async record(fact: PolicyAuditFact): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.auditService.record(manager, {
        entityType: 'A4_POLICY_DECISION',
        entityId: fact.decisionReference,
        action: fact.action,
        actor: fact.actor,
        correlationId: fact.correlationId,
        requestId: fact.requestId,
        newValues: {
          customerId: fact.customerId,
          capability: fact.capability,
          policyVersion: fact.policyVersion,
          decision: fact.decision,
          requestHash: fact.requestHash,
          normalizedInputHash: fact.normalizedInputHash,
          metadata: fact.metadata ?? {},
        },
      }),
    );
  }
}
