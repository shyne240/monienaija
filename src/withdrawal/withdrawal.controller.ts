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

import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { PaymentReasonDto } from '../payment/dto/payment-reason.dto';
import { WithdrawalService } from './withdrawal.service';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('withdrawals')
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService, private readonly auth: AuthorizationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWithdrawal(
    @Body() dto: CreateWithdrawalDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    if (this.isWorkforce(req)) await this.requireFunction(req!, 'transaction.view');
    return this.withdrawalService.createWithdrawal({
      walletId: dto.walletId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: idempotencyKey ?? '',
      reference: dto.reference,
      narration: dto.narration,
    });
  }

  @Get()
  async listWithdrawals(@Query('walletId') walletId?: string, @Req() req?: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req!, 'transaction.view');
    return this.withdrawalService.listWithdrawals(walletId);
  }

  @Get(':withdrawalId')
  async getWithdrawal(@Param('withdrawalId') withdrawalId: string, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'transaction.view');
    return this.withdrawalService.getWithdrawal(withdrawalId);
  }

  @Post(':withdrawalId/process')
  @HttpCode(HttpStatus.OK)
  async processWithdrawal(@Param('withdrawalId') withdrawalId: string, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'transaction.view');
    return this.withdrawalService.processWithdrawal(withdrawalId);
  }

  @Post(':withdrawalId/complete')
  @HttpCode(HttpStatus.OK)
  async completeWithdrawal(@Param('withdrawalId') withdrawalId: string, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'transaction.view');
    return this.withdrawalService.completeWithdrawal(withdrawalId);
  }

  @Post(':withdrawalId/fail')
  @HttpCode(HttpStatus.OK)
  async failWithdrawal(@Param('withdrawalId') withdrawalId: string, @Body() dto: PaymentReasonDto, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'transaction.view');
    return this.withdrawalService.failWithdrawal(withdrawalId, dto.reason);
  }

  @Post(':withdrawalId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelWithdrawal(@Param('withdrawalId') withdrawalId: string, @Body() dto: PaymentReasonDto, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'transaction.view');
    return this.withdrawalService.cancelWithdrawal(withdrawalId, dto.reason);
  }

  private isWorkforce(req?: AuthenticatedRequest): boolean {
    const t = req?.authorizationPrincipal?.type;
    return t === 'SUPPORT' || t === 'OPERATOR' || t === 'SERVICE' || t === 'PRIVILEGED';
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'withdrawals', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }
}
