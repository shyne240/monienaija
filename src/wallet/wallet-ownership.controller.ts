import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import {
  ExecuteWalletOwnershipResolutionDto,
  RequestWalletOwnershipResolutionDto,
} from './dto/wallet-ownership-resolution.dto';
import { WalletOwnershipResolutionService } from './wallet-ownership-resolution.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * Governed wallet ownership resolution surface.
 *
 * The routes are reachable only through the workforce session policy that already covers
 * `/api/v1/wallets` (`RuntimeAccessGuard` -> WORKFORCE_SESSION, SUPPORT excluded from writes by
 * the service). Neither route accepts an owner/class from the caller as an authority: the maker
 * endpoint files a `WALLET_OWNERSHIP_RESOLUTION` maker-checker request and the execution endpoint
 * consumes an independently approved request. There is no generic "set owner" endpoint, and this
 * surface cannot change a ledger account, a balance, or a wallet id.
 */
@Controller('wallets')
export class WalletOwnershipController {
  constructor(private readonly resolution: WalletOwnershipResolutionService) {}

  @Post(':walletId/ownership-resolution/request')
  @HttpCode(HttpStatus.CREATED)
  async requestResolution(
    @Param('walletId') walletId: string,
    @Body() dto: RequestWalletOwnershipResolutionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    return this.resolution.requestResolution({
      principal,
      walletId,
      resolutionClass: dto.resolutionClass,
      targetOwnerId: dto.targetOwnerId,
      systemOwnerCode: dto.systemOwnerCode,
      evidenceType: dto.evidenceType,
      evidenceReference: dto.evidenceReference,
      reason: dto.reason,
      expiresInSeconds: dto.expiresInSeconds,
    });
  }

  @Post(':walletId/ownership-resolution')
  @HttpCode(HttpStatus.CREATED)
  async executeResolution(
    @Param('walletId') walletId: string,
    @Body() dto: ExecuteWalletOwnershipResolutionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    return this.resolution.executeResolution({
      principal,
      walletId,
      resolutionClass: dto.resolutionClass,
      targetOwnerId: dto.targetOwnerId,
      systemOwnerCode: dto.systemOwnerCode,
      evidenceType: dto.evidenceType,
      evidenceReference: dto.evidenceReference,
      reason: dto.reason,
      approvalId: dto.approvalId,
    });
  }

  /**
   * Catalogue note: no approved `authorization_functions` row covers wallet ownership resolution
   * (`reconciliation.investigate/resolve` are FUTURE and `assignable: false`). The maker gate is
   * therefore the registered governed action's approved role rule (`FINANCE_PREPARER`, MFA),
   * enforced by `PrivilegedActionApprovalService.request`. This check only fails closed for an
   * absent principal.
   */
  private requirePrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    if (!req?.authorizationPrincipal) {
      throw new UnauthorizedException('Authentication required');
    }
    return req.authorizationPrincipal;
  }
}
