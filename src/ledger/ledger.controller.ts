import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  NotFoundException,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { CreateLedgerAccountDto } from './dto/create-ledger-account.dto';
import { PostJournalDto, RequestReversalDto, ReverseJournalDto } from './dto/post-journal.dto';
import { LedgerService } from './ledger.service';
import { LedgerReversalGovernanceService } from './ledger-reversal-governance.service';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { InstitutionWorkforceScopeService } from '../institution/institution-workforce-scope.service';
import type { LedgerAccountView } from './ledger.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('ledger')
export class LedgerController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly reversalGovernance: LedgerReversalGovernanceService,
    private readonly auth: AuthorizationService,
    private readonly institutionScope: InstitutionWorkforceScopeService,
  ) {}

  /**
   * Generic account creation has no approved catalogue function or maker/checker policy. Keep
   * account creation closed until that governance exists; system provisioning remains service-owned.
   */
  @Post('accounts')
  @HttpCode(HttpStatus.CREATED)
  createAccount(
    @Body() dto: CreateLedgerAccountDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<never> {
    void dto;
    void req;
    return Promise.reject(
      new ForbiddenException(
        'Generic ledger account creation is disabled pending approved governance',
      ),
    );
  }

  @Get('accounts')
  async listAccounts(@Req() req: AuthenticatedRequest, @Query('currency') currency?: string) {
    if (req?.authorizationPrincipal) await this.requireFunction(req, 'ledger.view');
    const accountList = await this.ledgerService.listAccounts(currency);
    return this.visibleAccounts(req.authorizationPrincipal, accountList);
  }

  @Get('accounts/:accountId/balance')
  async getAccountBalance(@Param('accountId') accountId: string, @Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'ledger.view');
    const account = await this.ledgerService.getAccount(accountId);
    await this.assertAccountScope(req.authorizationPrincipal, account);
    return this.ledgerService.getAccountBalance(accountId);
  }

  @Get('accounts/:accountId')
  async getAccount(@Param('accountId') accountId: string, @Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'ledger.view');
    const account = await this.ledgerService.getAccount(accountId);
    await this.assertAccountScope(req.authorizationPrincipal, account);
    return account;
  }

  @Post('journals')
  @HttpCode(HttpStatus.CREATED)
  postJournal(
    @Req() req: AuthenticatedRequest,
    @Body() dto: PostJournalDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ): Promise<never> {
    void req;
    void dto;
    void headerIdempotencyKey;
    return Promise.reject(
      new ForbiddenException(
        'Generic ledger journal posting is disabled pending approved governance',
      ),
    );
  }

  @Get('journals/:journalId')
  async getJournal(@Param('journalId') journalId: string, @Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'ledger.view');
    const journal = await this.ledgerService.getJournal(journalId);
    await this.assertJournalScope(req.authorizationPrincipal, journal.institutionId ?? null);
    return journal;
  }

  @Post('journals/:journalId/reversal-request')
  @HttpCode(HttpStatus.CREATED)
  async requestJournalReversal(
    @Req() req: AuthenticatedRequest,
    @Param('journalId') journalId: string,
    @Body() dto: RequestReversalDto,
  ) {
    // Maker side of the journal-reversal maker-checker control (P0-B): FINANCE_PREPARER
    // (`ledger.reverse`) initiates; the request is recorded under the registered
    // LEDGER_JOURNAL_REVERSAL / LEDGER_JOURNAL governed action with a server-computed
    // deterministic fingerprint of the actual request (action + journal id + reason).
    await this.requireFunction(req, 'ledger.reverse');
    // Institution scope is enforced for the reversal too: holding ledger.reverse does not let an
    // operator reverse another institution's attributed journal through the direct API (which
    // would otherwise bypass the finance-operations screen's scoping).
    const journal = await this.ledgerService.getJournal(journalId);
    await this.assertJournalScope(req.authorizationPrincipal, journal.institutionId ?? null);
    return this.reversalGovernance.requestReversal({
      principal: req.authorizationPrincipal!,
      journalId,
      reason: dto.reason,
      expiresInSeconds: dto.expiresInSeconds,
    });
  }

  @Post('journals/:journalId/reversal')
  @HttpCode(HttpStatus.CREATED)
  async reverseJournal(
    @Req() req: AuthenticatedRequest,
    @Param('journalId') journalId: string,
    @Body() dto: ReverseJournalDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    // Checker-execution side (P0-B): execution REQUIRES an approved maker-checker request
    // (approvalId) and consumes it under the established separation-of-duties controls —
    // the ungoverned direct-write reversal path is closed. Deliberately NOT gated by
    // `ledger.reverse` (a PREPARER-only function): the established executor-entitlement rule
    // (approving FINANCE_CONTROLLER or `privileged:execute`) applies instead, enforced both
    // here and inside consume().
    const principal = req?.authorizationPrincipal;
    if (!principal) {
      throw new UnauthorizedException('Authentication required');
    }
    const journal = await this.ledgerService.getJournal(journalId);
    await this.assertJournalScope(principal, journal.institutionId ?? null);
    return this.reversalGovernance.executeReversal({
      principal,
      journalId,
      reason: dto.reason,
      approvalId: dto.approvalId,
      idempotencyKey: dto.idempotencyKey ?? headerIdempotencyKey,
    });
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'ledger', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }

  /**
   * Institution-attributed journals and accounts are visible only to platform-level staff or a
   * principal with an ACTIVE assignment to that exact institution. Unattributed legacy records are
   * left on the pre-existing function gate (`ledger.view` / `ledger.reverse`) — they belong to no
   * institution, so there is no institution scope to enforce. Denial is 404 so the endpoint cannot
   * be used to enumerate another institution's record ids.
   */
  private async assertJournalScope(
    principal: AuthorizationPrincipal | undefined,
    institutionId: string | null,
  ): Promise<void> {
    if (!institutionId || !principal) return;
    if (this.institutionScope.hasPlatformAuthority(principal)) return;
    try {
      await this.institutionScope.assertCanAccessInstitution(principal, institutionId);
    } catch {
      throw new NotFoundException('Journal not found');
    }
  }

  private async assertAccountScope(
    principal: AuthorizationPrincipal | undefined,
    account: LedgerAccountView,
  ): Promise<void> {
    if (!account.institutionId || !principal) return;
    if (this.institutionScope.hasPlatformAuthority(principal)) return;
    try {
      await this.institutionScope.assertCanAccessInstitution(
        principal,
        account.institutionId ?? null,
      );
    } catch {
      throw new NotFoundException('Ledger account not found');
    }
  }

  private async visibleAccounts(
    principal: AuthorizationPrincipal | undefined,
    accounts: LedgerAccountView[],
  ): Promise<LedgerAccountView[]> {
    if (!principal) return accounts;
    if (this.institutionScope.hasPlatformAuthority(principal)) return accounts;
    const institutionIds = await this.institutionScope.institutionIdsForPrincipal(
      principal.principalId,
    );
    const allowed = new Set(institutionIds.map((id) => id.toLowerCase()));
    return accounts.filter(
      (account) => !account.institutionId || allowed.has(account.institutionId.toLowerCase()),
    );
  }
}
