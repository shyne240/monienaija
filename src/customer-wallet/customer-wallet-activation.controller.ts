import { Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CustomerWalletActivationService } from './customer-wallet-activation.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * `GET/POST /customers/me/activation` — customer-owned onboarding completion.
 *
 * The `customers/me/*` route policy restricts every path here to a CUSTOMER SELF principal, and
 * the service re-checks the principal type and id before doing anything. The endpoint provisions
 * the customer's own wallet after every verification gate passes; it never activates a customer
 * lifecycle (that stays with the governed workforce transition) and never touches credentials/PINs.
 */
@Controller('customers/me/activation')
export class CustomerWalletActivationController {
  constructor(private readonly activation: CustomerWalletActivationService) {}

  /** Read-only: what is still outstanding before this customer's wallet can be provisioned. */
  @Header('Cache-Control', 'no-store')
  @Get()
  view(@Req() req: AuthenticatedRequest) {
    return this.activation.view(req.authorizationPrincipal);
  }

  /**
   * Idempotent wallet provisioning. Requires an `Idempotency-Key` header; replaying the same key
   * converges on the same wallet instead of creating another.
   */
  @Header('Cache-Control', 'no-store')
  @Post()
  @HttpCode(200)
  activate(@Req() req: AuthenticatedRequest) {
    const raw = req.headers['idempotency-key'];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    return this.activation.activate(req.authorizationPrincipal, provided);
  }
}
