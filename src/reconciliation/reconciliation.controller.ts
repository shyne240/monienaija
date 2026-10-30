import { Controller, Get, Param, Req } from '@nestjs/common';

import { ReconciliationService } from './reconciliation.service';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/** Internal finance verification surface; not a customer or partner API. */
@Controller('internal/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService, private readonly auth: AuthorizationService) {}

  @Get('report')
  async getReport(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'reconciliation.view');
    return this.reconciliationService.runReconciliation();
  }

  @Get('trial-balance')
  async getTrialBalance(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'reconciliation.view');
    return this.reconciliationService.getTrialBalance();
  }

  @Get('finance')
  async getFinanceVerification(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'reconciliation.view');
    return this.reconciliationService.getFinanceVerification();
  }

  @Get('accounts/:accountId/activity')
  async getAccountActivity(@Param('accountId') accountId: string, @Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'reconciliation.view');
    return this.reconciliationService.getAccountActivity(accountId);
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'internal-reconciliation', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }
}
