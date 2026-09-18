import {
  Body,
  Controller,
  ForbiddenException,
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
import { customerSelfId } from './wallet-ownership';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { ListWalletsDto } from './dto/list-wallets.dto';
import { WalletService } from './wallet.service';

@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createWallet(
    @Body() dto: CreateWalletDto,
    @Req() request: PrincipalRequest,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    // Defence in depth for a route that is currently internal-only: if an authenticated customer
    // ever reaches it, the wallet owner is taken from the session and a body that names a different
    // customer is refused. The customer-facing creation path is `POST /customers/:id/wallets`.
    const customerId = customerSelfId(currentPrincipal(request));
    if (customerId && dto.customerId.trim() !== customerId) {
      throw new ForbiddenException('Authorization denied');
    }
    return this.walletService.createWallet({
      customerId: customerId ?? dto.customerId,
      currency: dto.currency,
      idempotencyKey: dto.idempotencyKey ?? headerIdempotencyKey ?? '',
    });
  }

  @Get()
  listWallets(@Req() request: PrincipalRequest, @Query() query: ListWalletsDto) {
    const customerId = customerSelfId(currentPrincipal(request));
    if (customerId) {
      // A customer may only ever list their own wallets; the query parameter cannot widen the scope.
      if (query.customerId && query.customerId.trim() !== customerId) {
        throw new ForbiddenException('Authorization denied');
      }
      return this.walletService.listWallets(customerId);
    }
    return this.walletService.listWallets(query.customerId);
  }

  @Get(':walletId/balance')
  getBalance(@Param('walletId') walletId: string, @Req() request: PrincipalRequest) {
    const customerId = customerSelfId(currentPrincipal(request));
    if (customerId) {
      return this.walletService.getWalletBalanceForCustomer(walletId, customerId);
    }
    return this.walletService.getWalletBalance(walletId);
  }

  @Get(':walletId')
  getWallet(@Param('walletId') walletId: string, @Req() request: PrincipalRequest) {
    const customerId = customerSelfId(currentPrincipal(request));
    if (customerId) {
      return this.walletService.getWalletForCustomer(walletId, customerId);
    }
    return this.walletService.getWallet(walletId);
  }
}
