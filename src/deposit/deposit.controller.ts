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

import { CreateDepositDto } from './dto/create-deposit.dto';
import { PaymentReasonDto } from '../payment/dto/payment-reason.dto';
import { DepositService } from './deposit.service';

@Controller('deposits')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createDeposit(
    @Body() dto: CreateDepositDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
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
  listDeposits(@Query('walletId') walletId?: string) {
    return this.depositService.listDeposits(walletId);
  }

  @Get(':depositId')
  getDeposit(@Param('depositId') depositId: string) {
    return this.depositService.getDeposit(depositId);
  }

  @Post(':depositId/complete')
  @HttpCode(HttpStatus.OK)
  completeDeposit(@Param('depositId') depositId: string) {
    return this.depositService.completeDeposit(depositId);
  }

  @Post(':depositId/fail')
  @HttpCode(HttpStatus.OK)
  failDeposit(@Param('depositId') depositId: string, @Body() dto: PaymentReasonDto) {
    return this.depositService.failDeposit(depositId, dto.reason);
  }

  @Post(':depositId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelDeposit(@Param('depositId') depositId: string, @Body() dto: PaymentReasonDto) {
    return this.depositService.cancelDeposit(depositId, dto.reason);
  }
}
