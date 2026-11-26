import { Controller, Get, Param, Query, Req, UnauthorizedException } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { FinanceOperationsService } from './finance-operations.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const WORKFORCE_TYPES = ['OPERATOR', 'SERVICE', 'PRIVILEGED'] as const;

/**
 * Admin Web Finance Operations — read-only investigation surface plus the *existing* governed
 * reversal workflow.
 *
 * Every route is registered in `route-policy-registry.ts`, so the guard decides which principal
 * type may address it and which catalogue function it must hold; each handler re-checks the same
 * function through `AuthorizationService.requireFunction`. Institution scope is resolved inside
 * the service on every request from `workforce_institution_assignments`.
 *
 * What is deliberately absent: any route that posts a journal, adjusts a balance, credits an
 * unallocated receipt or marks a reconciliation difference as resolved without evidence. Reversal
 * execution stays on `POST /ledger/journals/:id/reversal` (approval consumption is the write);
 * exception resolution stays on the banking controller's existing governed decision route.
 */
@Controller('internal/finance-operations')
export class FinanceOperationsController {
  constructor(
    private readonly finance: FinanceOperationsService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('ledger/journals')
  async journals(
    @Req() req: AuthenticatedRequest,
    @Query('reference') reference?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('institutionId') institutionId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const principal = await this.require(req, 'ledger.view', 'FINANCE_LEDGER_SEARCH');
    return this.finance.searchJournals(principal, {
      reference,
      from,
      to,
      institutionId,
      status,
      limit,
      offset,
    });
  }

  @Get('ledger/journals/:journalId')
  async journal(@Req() req: AuthenticatedRequest, @Param('journalId') journalId: string) {
    const principal = await this.require(req, 'ledger.view', 'FINANCE_LEDGER_JOURNAL');
    return this.finance.getJournal(principal, journalId);
  }

  @Get('ledger/journals/:journalId/reversal-eligibility')
  async reversalEligibility(
    @Req() req: AuthenticatedRequest,
    @Param('journalId') journalId: string,
  ) {
    const principal = await this.require(req, 'ledger.view', 'FINANCE_LEDGER_REVERSAL_STATE');
    return this.finance.reversalEligibility(principal, journalId);
  }

  /**
   * The shared Transaction History detail-link contract: a transaction resolves to its own
   * journal summary. Without `ledger.view` the caller receives an explicit access outcome, not
   * ledger content.
   */
  @Get('transactions/:transactionId/journal')
  async transactionJournal(
    @Req() req: AuthenticatedRequest,
    @Param('transactionId') transactionId: string,
    @Query('type') type?: string,
  ) {
    const principal = await this.require(req, 'transaction.view', 'FINANCE_TRANSACTION_JOURNAL');
    return this.finance.transactionJournal(principal, transactionId, type);
  }

  @Get('reconciliation/institutions')
  async institutions(@Req() req: AuthenticatedRequest) {
    const principal = await this.require(
      req,
      'reconciliation.view',
      'FINANCE_RECONCILIATION_INSTITUTIONS',
    );
    return this.finance.listInstitutions(principal);
  }

  @Get('reconciliation/breaks')
  async breaks(
    @Req() req: AuthenticatedRequest,
    @Query('institutionId') institutionId?: string,
    @Query('source') source?: string,
    @Query('state') state?: string,
    @Query('severity') severity?: string,
    @Query('kind') kind?: string,
    @Query('reference') reference?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const principal = await this.require(
      req,
      'reconciliation.view',
      'FINANCE_RECONCILIATION_BREAKS',
    );
    return this.finance.reconciliationBreaks(principal, {
      institutionId,
      source,
      state,
      severity,
      kind,
      reference,
      from,
      to,
      limit,
    });
  }

  private async require(
    req: AuthenticatedRequest,
    functionCode: string,
    resourceType: string,
  ): Promise<AuthorizationPrincipal> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    await this.auth.requireFunction(principal, functionCode, resourceType, WORKFORCE_TYPES);
    return principal;
  }
}
