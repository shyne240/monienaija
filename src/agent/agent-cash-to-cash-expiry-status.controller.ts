import { Controller, Get, Req } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentCashToCashExpiryWorker } from './agent-cash-to-cash-expiry-worker.service';

interface AuthenticatedRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

/** Read-only operational evidence. This route never starts a sweep or disposes of funds. */
@Controller('internal/admin/cash-to-cash')
export class AgentCashToCashExpiryStatusController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: AuthorizationService,
    private readonly worker: AgentCashToCashExpiryWorker,
  ) {}

  @Get('expiry-status')
  async status(@Req() req: AuthenticatedRequest) {
    await this.authorizationService.requireFunction(
      req.authorizationPrincipal,
      'transaction.view',
      'agent-cash-to-cash-operations',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    // One database snapshot and clock for both backlog and terminal-state counts.
    // Only aggregate state is returned; no phone, transfer ID, code or money values.
    const rows: Array<{
      as_of: Date;
      due_count: string;
      oldest_due_at: Date | null;
      expired_count: string;
    }> = await this.dataSource.query(`
      WITH observed AS MATERIALIZED (SELECT clock_timestamp() AS as_of)
      SELECT observed.as_of,
             (SELECT count(*)::text FROM cash_to_cash_transfers
               WHERE status = 'UNCLAIMED' AND expires_at <= observed.as_of) AS due_count,
             (SELECT min(expires_at) FROM cash_to_cash_transfers
               WHERE status = 'UNCLAIMED' AND expires_at <= observed.as_of) AS oldest_due_at,
             (SELECT count(*)::text FROM cash_to_cash_transfers
               WHERE status = 'EXPIRED') AS expired_count
        FROM observed
    `);
    const row = rows[0]!;
    return {
      asOf: row.as_of,
      dueCount: Number(row.due_count),
      oldestDueAt: row.oldest_due_at,
      expiredCount: Number(row.expired_count),
      worker: this.worker.getStatus(),
    };
  }
}
