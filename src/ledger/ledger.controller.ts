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
} from '@nestjs/common';

import { CreateLedgerAccountDto } from './dto/create-ledger-account.dto';
import { ListJournalsDto } from './dto/list-journals.dto';
import { PostJournalDto, ReverseJournalDto } from './dto/post-journal.dto';
import { LedgerService } from './ledger.service';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  /** Internal chart-of-accounts operation; monetary journals remain ledger-owned. */
  @Post('accounts')
  @HttpCode(HttpStatus.CREATED)
  createAccount(@Body() dto: CreateLedgerAccountDto) {
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
  listAccounts(@Query('currency') currency?: string) {
    return this.ledgerService.listAccounts(currency);
  }

  @Get('accounts/:accountId/balance')
  getAccountBalance(@Param('accountId') accountId: string) {
    return this.ledgerService.getAccountBalance(accountId);
  }

  @Get('accounts/:accountId')
  getAccount(@Param('accountId') accountId: string) {
    return this.ledgerService.getAccount(accountId);
  }

  @Post('journals')
  @HttpCode(HttpStatus.CREATED)
  postJournal(
    @Body() dto: PostJournalDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
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

  /**
   * A5T12 — read-only paginated ledger journal listing.
   *
   * Authorization is inherited, not invented: `/api/v1/ledger/*` resolves to
   * the route policy registry's default `internal-route` policy, which already
   * requires an authenticated principal holding the `internal:access` scope and
   * restricts callers to SUPPORT/OPERATOR/SERVICE/PRIVILEGED with
   * `customerAccess: 'NONE'`. This is exactly the boundary the existing
   * `GET journals/:journalId` read already enforces.
   *
   * Declared before `journals/:journalId` so the static path is unambiguous.
   */
  @Get('journals')
  listJournals(@Query() query: ListJournalsDto) {
    return this.ledgerService.listJournals(query);
  }

  @Get('journals/:journalId')
  getJournal(@Param('journalId') journalId: string) {
    return this.ledgerService.getJournal(journalId);
  }

  @Post('journals/:journalId/reversal')
  @HttpCode(HttpStatus.CREATED)
  reverseJournal(
    @Param('journalId') journalId: string,
    @Body() dto: ReverseJournalDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    return this.ledgerService.reverseJournal(
      journalId,
      dto.idempotencyKey ?? headerIdempotencyKey ?? '',
      dto.reason,
    );
  }
}
