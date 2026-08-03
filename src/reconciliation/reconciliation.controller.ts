import { Controller, Get, Param } from '@nestjs/common';

import { ReconciliationService } from './reconciliation.service';

/** Internal finance verification surface; not a customer or partner API. */
@Controller('internal/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get('report')
  getReport() {
    return this.reconciliationService.runReconciliation();
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
