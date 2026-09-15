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
import { CreateDepositDto } from './dto/create-deposit.dto';
import { PaymentReasonDto } from '../payment/dto/payment-reason.dto';
import { DepositService } from './deposit.service';
import { customerSelfId, walletOwnershipBinding } from '../wallet/wallet-ownership';

@Controller('deposits')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createDeposit(
    @Body() dto: CreateDepositDto,
    @Req() request: PrincipalRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // The credited wallet must belong to the authenticated customer; the binding is derived from
    // the session, never from the request body.
    return this.depositService.createDeposit({
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
  listDeposits(@Req() request: PrincipalRequest, @Query('walletId') walletId?: string) {
    const customerId = customerSelfId(currentPrincipal(request));
    if (customerId) {
      return this.depositService.listDepositsForCustomer(customerId, walletId);
    }
    return this.depositService.listDeposits(walletId);
  }

  @Get(':depositId')
  getDeposit(@Param('depositId') depositId: string, @Req() request: PrincipalRequest) {
    const customerId = customerSelfId(currentPrincipal(request));
    if (customerId) {
      return this.depositService.getDepositForCustomer(depositId, customerId);
    }
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
