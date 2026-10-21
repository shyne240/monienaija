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
} from '@nestjs/common';

import { CreateLedgerAccountDto } from './dto/create-ledger-account.dto';
import { PostJournalDto, ReverseJournalDto } from './dto/post-journal.dto';
import { LedgerService } from './ledger.service';
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

  @Post('journals/:journalId/reversal')
  @HttpCode(HttpStatus.CREATED)
  async reverseJournal(
    @Req() req: AuthenticatedRequest,
    @Param('journalId') journalId: string,
    @Body() dto: ReverseJournalDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    if (req?.authorizationPrincipal) {
      await this.requireFunction(req, 'ledger.reverse');
    }
    return this.ledgerService.reverseJournal(
      journalId,
      dto.idempotencyKey ?? headerIdempotencyKey ?? '',
      dto.reason,
    );
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'ledger', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }
}
