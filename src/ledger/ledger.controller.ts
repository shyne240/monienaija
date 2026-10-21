import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { CreateLedgerAccountDto } from './dto/create-ledger-account.dto';
import {
  PostJournalDto,
  RequestReversalDto,
  ReverseJournalDto,
} from './dto/post-journal.dto';
import { LedgerService } from './ledger.service';
import { LedgerReversalGovernanceService } from './ledger-reversal-governance.service';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

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
  ) {}

  /** Internal chart-of-accounts operation; monetary journals remain ledger-owned. */
  @Post('accounts')
  @HttpCode(HttpStatus.CREATED)
  async createAccount(@Body() dto: CreateLedgerAccountDto, @Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'ledger.post');
    return this.ledgerService.createAccount({
      code: dto.code,
      name: dto.name,
      accountType: dto.accountType,
      normalBalance: dto.normalBalance,
      currency: dto.currency,
      accountingUnit: dto.accountingUnit,
      allowNegativeBalance: dto.allowNegativeBalance,
    });
  }

  @Get('accounts')
  async listAccounts(@Req() req: AuthenticatedRequest, @Query('currency') currency?: string) {
    if (req?.authorizationPrincipal) await this.requireFunction(req, 'ledger.view');
    return this.ledgerService.listAccounts(currency);
  }

  @Get('accounts/:accountId/balance')
  async getAccountBalance(@Param('accountId') accountId: string, @Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'ledger.view');
    return this.ledgerService.getAccountBalance(accountId);
  }

  @Get('accounts/:accountId')
  async getAccount(@Param('accountId') accountId: string, @Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'ledger.view');
    return this.ledgerService.getAccount(accountId);
  }

  @Post('journals')
  @HttpCode(HttpStatus.CREATED)
  async postJournal(
    @Req() req: AuthenticatedRequest,
    @Body() dto: PostJournalDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    if (req?.authorizationPrincipal) await this.requireFunction(req, 'ledger.post');
    return this.ledgerService.postJournal({
      idempotencyKey: dto.idempotencyKey ?? headerIdempotencyKey ?? '',
      currency: dto.currency,
      accountingUnit: dto.accountingUnit,
      reference: dto.reference,
      description: dto.description,
      correlationId: dto.correlationId,
      metadata: dto.metadata,
      lines: dto.lines.map((line) => ({
        accountId: line.accountId,
        direction: line.direction,
        amountMinor: line.amountMinor,
      })),
    });
  }

  @Get('journals/:journalId')
  async getJournal(@Param('journalId') journalId: string, @Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'ledger.view');
    return this.ledgerService.getJournal(journalId);
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
}
