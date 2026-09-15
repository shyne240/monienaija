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

import { currentPrincipal, type PrincipalRequest } from '../authorization/current-principal';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { PaymentReasonDto } from '../payment/dto/payment-reason.dto';
import { WithdrawalService } from './withdrawal.service';
import { customerSelfId, walletOwnershipBinding } from '../wallet/wallet-ownership';

@Controller('withdrawals')
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createWithdrawal(
    @Body() dto: CreateWithdrawalDto,
    @Req() request: PrincipalRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // The debited wallet must belong to the authenticated customer; the binding is derived from
    // the session, never from the request body.
    return this.withdrawalService.createWithdrawal({
      walletId: dto.walletId,
      ownership: walletOwnershipBinding(currentPrincipal(request)),
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: idempotencyKey ?? '',
      reference: dto.reference,
      narration: dto.narration,
    });
  }

  @Get()
  listWithdrawals(@Req() request: PrincipalRequest, @Query('walletId') walletId?: string) {
    const customerId = customerSelfId(currentPrincipal(request));
    if (customerId) {
      return this.withdrawalService.listWithdrawalsForCustomer(customerId, walletId);
    }
    return this.withdrawalService.listWithdrawals(walletId);
  }

  @Get(':withdrawalId')
  getWithdrawal(@Param('withdrawalId') withdrawalId: string, @Req() request: PrincipalRequest) {
    const customerId = customerSelfId(currentPrincipal(request));
    if (customerId) {
      return this.withdrawalService.getWithdrawalForCustomer(withdrawalId, customerId);
    }
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
