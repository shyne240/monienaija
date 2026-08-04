import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { CreateCustomerWalletDto } from './dto/create-customer-wallet.dto';
import { CreateWalletAliasDto } from './dto/create-wallet-alias.dto';
import { UpdateCustomerWalletDto } from './dto/update-customer-wallet.dto';
import { CustomerWalletService } from './customer-wallet.service';

@Controller('customers')
export class CustomerWalletController {
  constructor(private readonly customerWalletService: CustomerWalletService) {}

  @Post(':id/wallets')
  createWallet(@Param('id') id: string, @Body() dto: CreateCustomerWalletDto) {
    return this.customerWalletService.createWallet(id, dto);
  }

  @Get(':id/wallets')
  listWallets(@Param('id') id: string) {
    return this.customerWalletService.listWallets(id);
  }

  @Get(':id/wallets/:walletId')
  getWallet(@Param('id') id: string, @Param('walletId') walletId: string) {
    return this.customerWalletService.getWallet(id, walletId);
  }

  @Patch(':id/wallets/:walletId')
  updateWallet(
    @Param('id') id: string,
    @Param('walletId') walletId: string,
    @Body() dto: UpdateCustomerWalletDto,
  ) {
    return this.customerWalletService.updateWallet(id, walletId, dto);
  }

  @Post(':id/wallets/:walletId/alias')
  createAlias(
    @Param('id') id: string,
    @Param('walletId') walletId: string,
    @Body() dto: CreateWalletAliasDto,
  ) {
    return this.customerWalletService.createAlias(id, walletId, dto);
  }

  @Get(':id/wallets/:walletId/history')
  listHistory(@Param('id') id: string, @Param('walletId') walletId: string) {
    return this.customerWalletService.listHistory(id, walletId);
  }

  @Get(':id/wallets/:walletId/ownership')
  getOwnership(@Param('id') id: string, @Param('walletId') walletId: string) {
    return this.customerWalletService.getOwnership(id, walletId);
  }
}
