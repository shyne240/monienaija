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
  Req,
} from '@nestjs/common';

import { CreateWalletDto } from './dto/create-wallet.dto';
import { ListWalletsDto } from './dto/list-wallets.dto';
import { WalletService } from './wallet.service';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService, private readonly auth: AuthorizationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWallet(
    @Body() dto: CreateWalletDto,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    if (this.isWorkforce(req)) await this.requireFunction(req!, 'customer.view_wallets');
    return this.walletService.createWallet({
      customerId: dto.customerId,
      currency: dto.currency,
      idempotencyKey: dto.idempotencyKey ?? headerIdempotencyKey ?? '',
    });
  }

  @Get()
  async listWallets(@Query() query: ListWalletsDto, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'customer.view_wallets');
    return this.walletService.listWallets(query.customerId);
  }

  @Get(':walletId/balance')
  async getBalance(@Param('walletId') walletId: string, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'customer.view_wallets');
    return this.walletService.getWalletBalance(walletId);
  }

  @Get(':walletId')
  async getWallet(@Param('walletId') walletId: string, @Req() req: AuthenticatedRequest) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'customer.view_wallets');
    return this.walletService.getWallet(walletId);
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
