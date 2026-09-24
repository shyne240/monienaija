import {
  Controller,
  Get,
  GoneException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { TransferHistoryQueryDto } from './dto/transfer-history-query.dto';
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

  /**
   * A5T13 — read-only GLOBAL operational transfer listing.
   *
   * Authorization is inherited, not invented: `/api/v1/transfers` resolves to
   * the route policy registry's default `internal-route` policy, which already
   * requires an authenticated principal holding the `internal:access` scope and
   * admits only SUPPORT/OPERATOR/SERVICE/PRIVILEGED with
   * `customerAccess: 'NONE'`. CUSTOMER principals are excluded, so this global
   * surface is not customer-reachable. Customers read their own transfers
   * through the wallet-scoped and customer-scoped surfaces instead.
   *
   * Declared before `:transferId` so the collection path is unambiguous.
   */
  @Get()
  listTransfers(@Query() query: TransferHistoryQueryDto) {
    return this.transferService.listTransfers(query.page, query.limit);
  }

  @Get(':transferId')
  getTransfer(@Param('transferId') transferId: string) {
    return this.transferService.getTransfer(transferId);
  }
}
