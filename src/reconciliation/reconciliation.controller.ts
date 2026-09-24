import { Controller, Get, Param, Query } from '@nestjs/common';

import { ListReconciliationBreaksDto } from './dto/list-reconciliation-breaks.dto';
import { ReconciliationService } from './reconciliation.service';

/** Internal finance verification surface; not a customer or partner API. */
@Controller('internal/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get('report')
  getReport() {
    return this.reconciliationService.runReconciliation();
  }

  /**
   * A5T14 — read-only reconciliation BREAK detail.
   *
   * Exposes the binding-reconciliation discrepancies the service already
   * produces. Declared before `trial-balance` purely for grouping with
   * `report`; the paths are distinct so ordering is not load-bearing.
   *
   * Authorization is inherited, not invented: `/api/v1/internal/reconciliation/*`
   * resolves to the route policy registry's default `internal-route` policy,
   * requiring the `internal:access` scope and admitting only
   * SUPPORT/OPERATOR/SERVICE/PRIVILEGED with `customerAccess: 'NONE'` — the
   * same boundary already protecting `report`, `trial-balance` and `finance`.
   *
   * Read-only: the underlying pass runs under `SET TRANSACTION READ ONLY`, and
   * no remediation or break resolution is performed or exposed.
   */
  @Get('report/breaks')
  getReportBreaks(@Query() query: ListReconciliationBreaksDto) {
    return this.reconciliationService.listBindingReconciliationBreaks(query);
  }

  @Get('trial-balance')
  getTrialBalance() {
    return this.reconciliationService.getTrialBalance();
  }

  @Get('finance')
  getFinanceVerification() {
    return this.reconciliationService.getFinanceVerification();
  }

  @Get('accounts/:accountId/activity')
  getAccountActivity(@Param('accountId') accountId: string) {
    return this.reconciliationService.getAccountActivity(accountId);
  }
}
