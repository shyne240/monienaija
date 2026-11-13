import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuditService } from '../operations/audit.service';
import {
  isRetryableTransactionError,
  MAX_SERIALIZABLE_ATTEMPTS,
} from '../common/serializable-transaction';
import { AgentTransactionAuthorizationService } from './agent-transaction-authorization.service';
import { AgentService } from './agent-service.enum';
import { requireCashOutAgentSession } from './cash-out-intent';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stops future claims; financial obligation remains in unclaimed liability pending disposition. */
@Injectable()
export class AgentCashToCashCancellationService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: AgentTransactionAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async cancel(transferId: string, pin: string, principal: AuthorizationPrincipal) {
    if (!UUID.test(transferId) || !pin || typeof pin !== 'string')
      throw new BadRequestException('Transfer and PIN required');
    if (
      principal?.type !== 'AGENT' ||
      !principal.agentId ||
      !principal.sessionId ||
      !UUID.test(principal.agentId) ||
      !UUID.test(principal.sessionId)
    )
      throw new UnauthorizedException('Agent session required');
    const agentId = principal.agentId;
    const authorized = await this.auth.authorize({
      agentId,
      service: AgentService.CASH_TO_CASH,
      pin,
      principal,
    });
    if (!authorized.allowed || !authorized.context)
      throw new ForbiddenException('Agent cancellation authorization unavailable');
    for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt++) {
      try {
        return await this.db.transaction('SERIALIZABLE', async (manager) => {
          const rows = await manager.query<
            Array<{ status: string; valid: boolean; journal_id: string }>
          >(
            `SELECT status,expires_at>clock_timestamp() AS valid,journal_id FROM cash_to_cash_transfers WHERE id=$1 AND agent_id=$2 FOR UPDATE`,
            [transferId, agentId],
          );
          const transfer = rows[0];
          if (!transfer) throw new ConflictException('Transfer unavailable');
          await requireCashOutAgentSession(manager, agentId, principal.sessionId);
          if (transfer.status === 'CANCELLED') {
            const evidence = await manager.query<Array<{ cancelled_at: Date }>>(
              `SELECT cancelled_at FROM cash_to_cash_cancellations WHERE transfer_id=$1 AND agent_id=$2`,
              [transferId, agentId],
            );
            if (!evidence[0]) throw new ConflictException('Cancellation evidence unavailable');
            return {
              transferId,
              status: 'CANCELLED' as const,
              disposition: 'PENDING' as const,
              cancelledAt: evidence[0].cancelled_at,
              replayed: true,
            };
          }
          if (transfer.status !== 'UNCLAIMED' || !transfer.valid)
            throw new ConflictException('Transfer is not cancellable');
          const evidence = await manager.query<Array<{ cancelled_at: Date }>>(
            `INSERT INTO cash_to_cash_cancellations(transfer_id,agent_id,session_id) VALUES($1,$2,$3) RETURNING cancelled_at`,
            [transferId, agentId, principal.sessionId],
          );
          await manager.query(
            `UPDATE cash_to_cash_transfers SET status='CANCELLED',updated_at=clock_timestamp() WHERE id=$1`,
            [transferId],
          );
          await this.audit.record(manager, {
            entityType: 'AGENT_CASH_TO_CASH',
            entityId: transferId,
            action: 'CASH_TO_CASH_CANCELLED',
            actor: agentId,
            previousValues: { status: 'UNCLAIMED' },
            newValues: {
              status: 'CANCELLED',
              disposition: 'PENDING',
              fundingJournalId: transfer.journal_id,
            },
          });
          return {
            transferId,
            status: 'CANCELLED' as const,
            disposition: 'PENDING' as const,
            cancelledAt: evidence[0]!.cancelled_at,
            replayed: false,
          };
        });
      } catch (error) {
        if (isRetryableTransactionError(error) && attempt + 1 < MAX_SERIALIZABLE_ATTEMPTS) continue;
        throw error;
      }
    }
    throw new ConflictException('Cancellation could not complete');
  }
}
