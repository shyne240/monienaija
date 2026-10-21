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

import { CreateDepositDto } from './dto/create-deposit.dto';
import { PaymentReasonDto } from '../payment/dto/payment-reason.dto';
import { DepositService } from './deposit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('deposits')
export class DepositController {
  constructor(private readonly depositService: DepositService, private readonly auth: AuthorizationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createDeposit(
    @Body() dto: CreateDepositDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    if (this.isWorkforce(req)) await this.requireFunction(req!, 'transaction.view');
    return this.depositService.createDeposit({
      walletId: dto.walletId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: idempotencyKey ?? '',
      reference: dto.reference,
      narration: dto.narration,
    });
  }

  @Get()
  async listDeposits(@Query('walletId') walletId?: string, @Req() req?: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req!, 'transaction.view');
    return this.depositService.listDeposits(walletId);
  }

  @Get(':depositId')
  async getDeposit(@Param('depositId') depositId: string, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'transaction.view');
    return this.depositService.getDeposit(depositId);
  }

  @Post(':depositId/complete')
  @HttpCode(HttpStatus.OK)
  async completeDeposit(@Param('depositId') depositId: string, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'transaction.view');
    return this.depositService.completeDeposit(depositId);
  }

  @Post(':depositId/fail')
  @HttpCode(HttpStatus.OK)
  async failDeposit(@Param('depositId') depositId: string, @Body() dto: PaymentReasonDto, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'transaction.view');
    return this.depositService.failDeposit(depositId, dto.reason);
  }

  @Post(':depositId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelDeposit(@Param('depositId') depositId: string, @Body() dto: PaymentReasonDto, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'transaction.view');
    return this.depositService.cancelDeposit(depositId, dto.reason);
  }

  private isWorkforce(req?: AuthenticatedRequest): boolean {
    const t = req?.authorizationPrincipal?.type;
    return t === 'SUPPORT' || t === 'OPERATOR' || t === 'SERVICE' || t === 'PRIVILEGED';
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'deposits', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }
}
