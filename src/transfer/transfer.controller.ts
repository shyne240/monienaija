import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';

import { currentPrincipal, type PrincipalRequest } from '../authorization/current-principal';
import { customerSelfId, walletOwnershipBinding } from '../wallet/wallet-ownership';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferService } from './transfer.service';

@Controller('transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createTransfer(
    @Body() dto: CreateTransferDto,
    @Req() request: PrincipalRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // The source wallet must belong to the authenticated customer; the destination wallet may
    // belong to another customer under the existing product rules.
    return this.transferService.createTransfer({
      sourceWalletId: dto.sourceWalletId,
      ownership: walletOwnershipBinding(currentPrincipal(request)),
      destinationWalletId: dto.destinationWalletId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: idempotencyKey ?? '',
      reference: dto.reference,
      narration: dto.narration,
    });
  }

  @Get(':transferId')
  getTransfer(@Param('transferId') transferId: string, @Req() request: PrincipalRequest) {
    const customerId = customerSelfId(currentPrincipal(request));
    if (customerId) {
      return this.transferService.getTransferForCustomer(transferId, customerId);
    }
    return this.transferService.getTransfer(transferId);
  }
}
