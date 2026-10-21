import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';

import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferService } from './transfer.service';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService, private readonly auth: AuthorizationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTransfer(
    @Body() dto: CreateTransferDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    if (this.isWorkforce(req)) await this.requireFunction(req!, 'transaction.view');
    return this.transferService.createTransfer({
      sourceWalletId: dto.sourceWalletId,
      destinationWalletId: dto.destinationWalletId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: idempotencyKey ?? '',
      reference: dto.reference,
      narration: dto.narration,
    });
  }

  @Get(':transferId')
  async getTransfer(@Param('transferId') transferId: string, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'transaction.view');
    return this.transferService.getTransfer(transferId);
  }

  private isWorkforce(req?: AuthenticatedRequest): boolean {
    const t = req?.authorizationPrincipal?.type;
    return t === 'SUPPORT' || t === 'OPERATOR' || t === 'SERVICE' || t === 'PRIVILEGED';
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'transfers', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }
}
