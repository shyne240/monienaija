import { Controller, Get, Param, Query, Req } from '@nestjs/common';

import { currentPrincipal, type PrincipalRequest } from '../authorization/current-principal';
import { customerSelfId } from '../wallet/wallet-ownership';
import { TransferHistoryQueryDto } from './dto/transfer-history-query.dto';
import { TransferService } from './transfer.service';

@Controller('wallets')
export class WalletTransactionController {
  constructor(private readonly transferService: TransferService) {}

  @Get(':walletId/transactions')
  getTransactions(
    @Param('walletId') walletId: string,
    @Query() query: TransferHistoryQueryDto,
    @Req() request: PrincipalRequest,
  ) {
    const customerId = customerSelfId(currentPrincipal(request));
    if (customerId) {
      return this.transferService.getWalletTransactionsForCustomer(
        walletId,
        customerId,
        query.page,
        query.limit,
      );
    }
    return this.transferService.getWalletTransactions(walletId, query.page, query.limit);
  }
}
