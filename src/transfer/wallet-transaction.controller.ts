import { Controller, Get, Param, Query, Req } from '@nestjs/common';

import { TransferHistoryQueryDto } from './dto/transfer-history-query.dto';
import { TransferService } from './transfer.service';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('wallets')
export class WalletTransactionController {
  constructor(private readonly transferService: TransferService, private readonly auth: AuthorizationService) {}

  @Get(':walletId/transactions')
  async getTransactions(@Param('walletId') walletId: string, @Query() query: TransferHistoryQueryDto, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'transaction.view');
    return this.transferService.getWalletTransactions(walletId, query.page, query.limit);
  }

  private isWorkforce(req?: AuthenticatedRequest): boolean {
    const t = req?.authorizationPrincipal?.type;
    return t === 'SUPPORT' || t === 'OPERATOR' || t === 'SERVICE' || t === 'PRIVILEGED';
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'wallets', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }
}
