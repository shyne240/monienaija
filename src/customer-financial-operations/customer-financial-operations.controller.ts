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

import type { AuthorizationRequest } from '../authorization/authorization.types';
import { TransferHistoryQueryDto } from '../transfer/dto/transfer-history-query.dto';
import { CustomerFinancialAccountReadService } from '../wallet/customer-financial-account-read.service';
import { CustomerFinancialOperationsService } from './customer-financial-operations.service';
import { CreateCustomerMoneyMovementDto } from './dto/create-customer-money-movement.dto';
import { CreateCustomerTransferDto } from './dto/create-customer-transfer.dto';

/**
 * Customer-facing financial surface. All routes sit under /customers/:id so
 * the runtime access guard enforces the authenticated CUSTOMER principal with
 * SELF customer access; the service layer then derives every financial
 * identifier through the customer's own CustomerWallet binding.
 */
@Controller('customers')
export class CustomerFinancialOperationsController {
  constructor(
    private readonly operations: CustomerFinancialOperationsService,
    private readonly financialAccountRead: CustomerFinancialAccountReadService,
  ) {}

  @Get(':id/financial-accounts')
  getFinancialAccounts(@Param('id') id: string, @Req() request: AuthorizationRequest) {
    const principal = request.authorizationPrincipal;
    if (!principal) {
      throw new UnauthorizedException('Authentication required');
    }
    return this.financialAccountRead.getCustomerFinancialAccounts({
      customerId: id,
      principal,
    });
  }

  @Post(':id/transfers')
  @HttpCode(HttpStatus.CREATED)
  createTransfer(
    @Param('id') id: string,
    @Body() dto: CreateCustomerTransferDto,
    @Req() request: AuthorizationRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const principal = request.authorizationPrincipal;
    if (!principal) {
      throw new UnauthorizedException('Authentication required');
    }
    return this.operations.createTransfer({
      customerId: id,
      principal,
      destinationWalletId: dto.destinationWalletId,
      destination: dto.destination,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: idempotencyKey ?? '',
      transactionPin: dto.transactionPin,
      reference: dto.reference,
      narration: dto.narration,
    });
  }

  /**
   * Recipient confirmation lookups. Resolving another customer's safe
   * recipient details is a legitimate customer operation; the response
   * contains only display-safe fields (no WalletAccount IDs, no binding IDs,
   * no customerId).
   */
  @Get(':id/recipients/by-number')
  resolveRecipientByNumber(@Param('id') id: string, @Query('number') number = '') {
    return this.operations.resolveRecipientByReceivingNumber(id, number);
  }

  @Get(':id/recipients/by-phone')
  resolveRecipientByPhone(@Param('id') id: string, @Query('phone') phone = '') {
    return this.operations.resolveRecipientByPhone(id, phone);
  }

  @Get(':id/wallets/:customerWalletId/transactions')
  getTransactions(
    @Param('id') id: string,
    @Param('customerWalletId') customerWalletId: string,
    @Query() query: TransferHistoryQueryDto,
  ) {
    return this.operations.getTransactions({
      customerId: id,
      customerWalletId,
      page: query.page,
      limit: query.limit,
    });
  }

  @Post(':id/deposits')
  @HttpCode(HttpStatus.CREATED)
  createDeposit(
    @Param('id') id: string,
    @Body() dto: CreateCustomerMoneyMovementDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.operations.createDeposit({
      customerId: id,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: idempotencyKey ?? '',
      reference: dto.reference,
      narration: dto.narration,
    });
  }

  @Post(':id/deposits/:depositId/complete')
  @HttpCode(HttpStatus.OK)
  completeDeposit(@Param('id') id: string, @Param('depositId') depositId: string) {
    return this.operations.completeDeposit(id, depositId);
  }

  @Post(':id/withdrawals')
  @HttpCode(HttpStatus.CREATED)
  createWithdrawal(
    @Param('id') id: string,
    @Body() dto: CreateCustomerMoneyMovementDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.operations.createWithdrawal({
      customerId: id,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: idempotencyKey ?? '',
      transactionPin: dto.transactionPin,
      reference: dto.reference,
      narration: dto.narration,
    });
  }

  @Post(':id/withdrawals/:withdrawalId/process')
  @HttpCode(HttpStatus.OK)
  processWithdrawal(@Param('id') id: string, @Param('withdrawalId') withdrawalId: string) {
    return this.operations.processWithdrawal(id, withdrawalId);
  }

  @Post(':id/withdrawals/:withdrawalId/complete')
  @HttpCode(HttpStatus.OK)
  completeWithdrawal(@Param('id') id: string, @Param('withdrawalId') withdrawalId: string) {
    return this.operations.completeWithdrawal(id, withdrawalId);
  }
}
