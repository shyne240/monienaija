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
    @Headers('idempotency-key') headerIdempotencyKey?: string,
  ) {
    return this.walletService.createWallet({
      customerId: dto.customerId,
      currency: dto.currency,
      idempotencyKey: dto.idempotencyKey ?? headerIdempotencyKey ?? '',
    });
  }

  @Get()
  listWallets(@Query() query: ListWalletsDto) {
    return this.walletService.listWallets(query.customerId);
  }

  @Get(':walletId/balance')
  getBalance(@Param('walletId') walletId: string) {
    return this.walletService.getWalletBalance(walletId);
  }

  @Get(':walletId')
  getWallet(@Param('walletId') walletId: string) {
    return this.walletService.getWallet(walletId);
  }
}
