import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { PolicyDecisionRecord } from './policy-decision-record.entity';
import type { PolicyAuditFact, PolicyAuditPort } from './capability-policy.types';

@Injectable()
export class TypeOrmPolicyAuditAdapter implements PolicyAuditPort {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async record(fact: PolicyAuditFact): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const decision = await manager
        .getRepository(PolicyDecisionRecord)
        .findOne({ where: { decisionReference: fact.decisionReference } });
      if (!decision) throw new ConflictException('A4 decision audit target unavailable');
      await this.auditService.record(manager, {
        entityType: 'A4_POLICY_DECISION',
        entityId: decision.id,
        action: fact.action,
        actor: fact.actor,
        correlationId: fact.correlationId,
        requestId: fact.requestId,
        newValues: {
          decisionReference: fact.decisionReference,
          customerId: fact.customerId,
          capability: fact.capability,
          policyVersion: fact.policyVersion,
          decision: fact.decision,
          requestHash: fact.requestHash,
          normalizedInputHash: fact.normalizedInputHash,
          metadata: fact.metadata ?? {},
        },
      });
    });
  }
}
