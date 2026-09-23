import { Controller, Get, GoneException, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { TransferService } from './transfer.service';

/**
 * Legacy wallet-scoped transfer surface. The mutating route was the pre-A5
 * execution path and is now retired: customer Wallet → Wallet movement runs
 * exclusively through POST /customers/:id/transfers, which admits commands
 * only via the A5T03 gate (A2/A4/A3/pilot/limit, fail-closed) and the A5T04
 * lifecycle. Read endpoints below keep serving existing transfer history.
 */
@Controller('transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createTransfer(): never {
    throw new GoneException(
      'POST /transfers is retired. Wallet-to-wallet transfers are executed only through ' +
        'POST /customers/:id/transfers, which enforces customer authentication, ownership ' +
        'binding, transaction PIN, and the A5 gate/lifecycle control path.',
    );
  }

  @Get(':transferId')
  getTransfer(@Param('transferId') transferId: string) {
    return this.transferService.getTransfer(transferId);
  }
}
