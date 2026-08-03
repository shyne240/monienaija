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

import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { PaymentReasonDto } from '../payment/dto/payment-reason.dto';
import { WithdrawalService } from './withdrawal.service';

@Controller('withdrawals')
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createWithdrawal(
    @Body() dto: CreateWithdrawalDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
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
  listWithdrawals(@Query('walletId') walletId?: string) {
    return this.withdrawalService.listWithdrawals(walletId);
  }

  @Get(':withdrawalId')
  getWithdrawal(@Param('withdrawalId') withdrawalId: string) {
    return this.withdrawalService.getWithdrawal(withdrawalId);
  }

  @Post(':withdrawalId/process')
  @HttpCode(HttpStatus.OK)
  processWithdrawal(@Param('withdrawalId') withdrawalId: string) {
    return this.withdrawalService.processWithdrawal(withdrawalId);
  }

  @Post(':withdrawalId/complete')
  @HttpCode(HttpStatus.OK)
  completeWithdrawal(@Param('withdrawalId') withdrawalId: string) {
    return this.withdrawalService.completeWithdrawal(withdrawalId);
  }

  @Post(':withdrawalId/fail')
  @HttpCode(HttpStatus.OK)
  failWithdrawal(@Param('withdrawalId') withdrawalId: string, @Body() dto: PaymentReasonDto) {
    return this.withdrawalService.failWithdrawal(withdrawalId, dto.reason);
  }

  @Post(':withdrawalId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelWithdrawal(@Param('withdrawalId') withdrawalId: string, @Body() dto: PaymentReasonDto) {
    return this.withdrawalService.cancelWithdrawal(withdrawalId, dto.reason);
  }
}
