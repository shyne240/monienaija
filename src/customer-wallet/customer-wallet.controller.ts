import { Body, Controller, Get, Param, Patch, Post, Req, UnauthorizedException } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CreateCustomerWalletDto } from './dto/create-customer-wallet.dto';
import { CreateWalletAliasDto } from './dto/create-wallet-alias.dto';
import { UpdateCustomerWalletDto } from './dto/update-customer-wallet.dto';
import { CustomerWalletService } from './customer-wallet.service';

interface AuthenticatedRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('customers')
export class CustomerWalletController {
  constructor(
    private readonly customerWalletService: CustomerWalletService,
    private readonly auth: AuthorizationService,
  ) {}

  @Post(':id/wallets')
  async createWallet(
    @Param('id') id: string,
    @Body() dto: CreateCustomerWalletDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireWalletCreate(req, id);
    return this.customerWalletService.createWallet(id, {
      type: dto.type,
      currency: dto.currency,
      status: dto.status,
      actor,
    });
  }

  @Get(':id/wallets')
  async listWallets(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireWalletView(req, id);
    return this.customerWalletService.listWallets(id);
  }

  @Get(':id/wallets/:walletId')
  async getWallet(
    @Param('id') id: string,
    @Param('walletId') walletId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.requireWalletView(req, id);
    return this.customerWalletService.getWallet(id, walletId);
  }

  @Patch(':id/wallets/:walletId')
  async updateWallet(
    @Param('id') id: string,
    @Param('walletId') walletId: string,
    @Body() dto: UpdateCustomerWalletDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // No authoritative catalogue function for status change — preserve existing
    // workforce vs self semantics but derive actor from principal.
    const actor = await this.requireWalletStatusChange(req, id);
    return this.customerWalletService.updateWallet(id, walletId, {
      status: dto.status,
      version: dto.version,
      actor,
    });
  }

  @Post(':id/wallets/:walletId/alias')
  async createAlias(
    @Param('id') id: string,
    @Param('walletId') walletId: string,
    @Body() dto: CreateWalletAliasDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // No authoritative catalogue function for alias — same as PATCH.
    const actor = await this.requireWalletAlias(req, id);
    return this.customerWalletService.createAlias(id, walletId, {
      alias: dto.alias,
      actor,
    });
  }

  @Get(':id/wallets/:walletId/history')
  async listHistory(
    @Param('id') id: string,
    @Param('walletId') walletId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.requireWalletView(req, id);
    return this.customerWalletService.listHistory(id, walletId);
  }

  @Get(':id/wallets/:walletId/ownership')
  async getOwnership(
    @Param('id') id: string,
    @Param('walletId') walletId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.requireWalletView(req, id);
    return this.customerWalletService.getOwnership(id, walletId);
  }

  private async requireWalletCreate(req: AuthenticatedRequest, customerId: string): Promise<string> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') {
      if (principal.customerId !== customerId) {
        throw new UnauthorizedException('Privileged access required');
      }
      return principal.principalId;
    }
    await this.auth.requireFunction(principal, 'customer.create_wallet', 'customer-wallet', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
    return principal.principalId;
  }

  private async requireWalletView(req: AuthenticatedRequest, customerId: string): Promise<void> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') {
      if (principal.customerId !== customerId) {
        throw new UnauthorizedException('Privileged access required');
      }
      return;
    }
    await this.auth.requireFunction(principal, 'customer.view_wallets', 'customer-wallet', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }

  private async requireWalletStatusChange(
    req: AuthenticatedRequest,
    customerId: string,
  ): Promise<string> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') {
      if (principal.customerId !== customerId) {
        throw new UnauthorizedException('Privileged access required');
      }
      return principal.principalId;
    }
    // No catalogue function — preserve workforce reachability (same principal types as create/view)
    // but still require authentication and derive actor from principal.
    if (
      principal.type === 'AGENT' ||
      principal.type === 'SUPPORT' ||
      (principal.type as string) === 'AGGREGATOR'
    ) {
      throw new UnauthorizedException('Privileged access required');
    }
    return principal.principalId;
  }

  private async requireWalletAlias(req: AuthenticatedRequest, customerId: string): Promise<string> {
    return this.requireWalletStatusChange(req, customerId);
  }
}
