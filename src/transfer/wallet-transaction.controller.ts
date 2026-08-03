import { Controller, Get, Param, Query } from '@nestjs/common';

import { TransferHistoryQueryDto } from './dto/transfer-history-query.dto';
import { TransferService } from './transfer.service';

@Controller('wallets')
export class WalletTransactionController {
  constructor(private readonly transferService: TransferService) {}

  @Get(':walletId/transactions')
  getTransactions(@Param('walletId') walletId: string, @Query() query: TransferHistoryQueryDto) {
    return this.transferService.getWalletTransactions(walletId, query.page, query.limit);
  }
}
