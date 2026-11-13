import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuditService } from '../operations/audit.service';
import { requireCashOutAgentSession } from './cash-out-intent';
import { CashOutInstitutionResolver } from './cash-out-institution.resolver';
import type { CashOutReconciliationDto } from './dto/cash-out-reconciliation.dto';

@Injectable()
export class CashOutReconciliationService {
  constructor(
    private readonly db: DataSource,
    private readonly audit: AuditService,
    private readonly resolver: CashOutInstitutionResolver,
  ) {}

  async handoff(
    principal: AuthorizationPrincipal,
    dto: CashOutReconciliationDto,
  ): Promise<{ id: string }> {
    const agentId = principal.agentId;
    const key = dto.idempotencyKey?.trim();
    if (
      principal.type !== 'AGENT' ||
      !agentId ||
      principal.principalId !== agentId ||
      !key ||
      key.length > 255
    )
      throw new UnauthorizedException('Agent authentication required');
    return this.db.transaction(async (manager) => {
      await requireCashOutAgentSession(manager, agentId, principal.sessionId);
      const rows = await manager.query<
        Array<{
          intent_id: string | null;
          customer_id: string | null;
          intent_status: string | null;
          institution_scope: string | null;
          journal_id: string | null;
          challenge_id: string | null;
        }>
      >(
        `SELECT i.id AS intent_id,COALESCE(i.customer_id,r.customer_id) AS customer_id,i.status AS intent_status,i.institution_scope,r.journal_id,r.challenge_id FROM (SELECT $1::uuid AS agent_id,$2::varchar AS operation_key) k LEFT JOIN cash_out_intents i ON i.agent_id=k.agent_id AND i.operation_key=k.operation_key LEFT JOIN cash_out_execution_records r ON r.agent_id=k.agent_id AND r.idempotency_key=k.operation_key`,
        [agentId, key],
      );
      const evidence = rows[0]!;
      let affiliation: unknown = { outcome: 'UNAVAILABLE' };
      try {
        affiliation = await this.resolver.resolve(manager, agentId, { lock: 'SHARE' });
      } catch {
        /* preserve explicit unavailable evidence */
      }
      const id = randomUUID();
      const inserted = await manager.query<Array<{ id: string }>>(
        `INSERT INTO cash_out_reconciliation_handoffs(id,agent_id,operation_key,customer_id,reason,evidence) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(agent_id,operation_key) DO NOTHING RETURNING id`,
        [
          id,
          agentId,
          key,
          evidence.customer_id,
          dto.reason,
          JSON.stringify({ ...evidence, affiliation }),
        ],
      );
      if (inserted[0]) {
        await this.audit.record(manager, {
          entityType: 'CASH_OUT_RECONCILIATION',
          entityId: id,
          action: 'HANDOFF_CREATED',
          actor: `agent:${agentId}`,
          newValues: { reason: dto.reason },
        });
        return { id };
      }
      const existing = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM cash_out_reconciliation_handoffs WHERE agent_id=$1 AND operation_key=$2`,
        [agentId, key],
      );
      return { id: existing[0]!.id };
    });
  }

  async lookup(agentId: string, key: string): Promise<unknown> {
    const rows = await this.db.query<Array<Record<string, unknown>>>(
      `SELECT h.id,h.agent_id,h.operation_key,COALESCE(h.customer_id,i.customer_id,r.customer_id) AS customer_id,h.reason,h.evidence,h.created_at,i.status AS current_intent_status,i.institution_scope AS current_institution_scope,r.journal_id AS current_journal_id FROM cash_out_reconciliation_handoffs h LEFT JOIN cash_out_intents i ON i.agent_id=h.agent_id AND i.operation_key=h.operation_key LEFT JOIN cash_out_execution_records r ON r.agent_id=h.agent_id AND r.idempotency_key=h.operation_key WHERE h.agent_id=$1 AND h.operation_key=$2`,
      [agentId, key],
    );
    if (!rows[0]) throw new NotFoundException('Reconciliation handoff not found');
    const audit = await this.db.query<Array<Record<string, unknown>>>(
      `SELECT action,actor,occurred_at,new_values FROM audit_events WHERE (entity_type='CASH_OUT_RECONCILIATION' AND entity_id=$1) OR (entity_type='CASH_OUT_INTENT' AND entity_id=($2::jsonb->>'intent_id')::uuid) ORDER BY occurred_at`,
      [rows[0].id, JSON.stringify(rows[0].evidence)],
    );
    return { ...rows[0], audit };
  }
}
