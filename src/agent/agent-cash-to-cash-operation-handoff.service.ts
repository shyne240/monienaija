import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuditService } from '../operations/audit.service';
import { AgentCashToCashRecoveryService } from './agent-cash-to-cash-recovery.service';

export type OperationHandoffReason = 'UNKNOWN_OUTCOME' | 'LOST_TRANSFER_CODE' | 'EVIDENCE_REVIEW';
@Injectable()
export class AgentCashToCashOperationHandoffService {
  constructor(
    private readonly db: DataSource,
    private readonly recovery: AgentCashToCashRecoveryService,
    private readonly audit: AuditService,
  ) {}
  async handoff(
    principal: AuthorizationPrincipal,
    operationKey: string,
    reason: OperationHandoffReason,
  ) {
    return this.db.transaction(async (manager) => {
      const { institutionId, result } = await this.recovery.recoverWithManager(
        manager,
        principal,
        operationKey,
      );
      const agentId = principal.agentId!;
      // Persist a minimal evidence snapshot, never one-time code, PIN, OTP, or phone.
      const evidence =
        result.status === 'FOUND'
          ? {
              status: result.status,
              transferId: result.transferId,
              lifecycleStatus: result.lifecycleStatus,
              journalId: result.journalId,
              claimJournalId: result.claimJournalId,
              principalMinor: result.principalMinor,
              currency: result.currency,
              disposition: result.disposition,
            }
          : result;
      const id = randomUUID();
      const inserted = await manager.query<Array<{ id: string }>>(
        `INSERT INTO cash_to_cash_operation_handoffs(id,agent_id,institution_id,operation_key,reason,evidence) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(agent_id,operation_key) DO NOTHING RETURNING id`,
        [id, agentId, institutionId, operationKey.trim(), reason, JSON.stringify(evidence)],
      );
      if (inserted[0]) {
        await this.audit.record(manager, {
          entityType: 'CASH_TO_CASH_OPERATION_HANDOFF',
          entityId: id,
          action: 'HANDOFF_CREATED',
          actor: `agent:${agentId}`,
          newValues: { reason, status: result.status },
        });
        return { id, status: 'UNRESOLVED' as const };
      }
      const existing = await manager.query<Array<{ id: string; institution_id: string }>>(
        `SELECT id,institution_id FROM cash_to_cash_operation_handoffs WHERE agent_id=$1 AND operation_key=$2`,
        [agentId, operationKey.trim()],
      );
      if (!existing[0] || existing[0].institution_id !== institutionId)
        throw new ConflictException('Handoff unavailable');
      return { id: existing[0].id, status: 'UNRESOLVED' as const };
    });
  }
}
