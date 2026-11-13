import { Controller, Get, Req } from '@nestjs/common';

import { WalletOwnershipReconciliationService } from './wallet-ownership-reconciliation.service';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * Administrative reconciliation visibility for governed wallet ownership.
 *
 * Read-only. Gated by the existing approved `reconciliation.view` catalogue function (the same
 * function every other finance reconciliation read requires) — no new capability is invented, and
 * no customer/agent principal can reach it (the route resolves through the workforce session
 * branch, and the function check runs against catalogue-governed workforce principals only).
 */
@Controller('internal/wallets')
export class WalletOwnershipReconciliationController {
  constructor(
    private readonly reconciliation: WalletOwnershipReconciliationService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('ownership-review')
  async getOwnershipReview(@Req() req: AuthenticatedRequest) {
    await this.auth.requireFunction(
      req.authorizationPrincipal,
      'reconciliation.view',
      'internal-wallet-ownership',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    return this.reconciliation.getOwnershipReview();
  }
}
