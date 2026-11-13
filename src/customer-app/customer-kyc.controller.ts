import { Controller, Get, Header, Req, UnauthorizedException } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CustomerKycViewService, type CustomerKycView } from './customer-kyc-view.service';

interface AuthenticatedRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * ARENA 4 (customer app) — `GET /customers/me/kyc`.
 *
 * Minimal, additive, self-only read added because the mobile app needs the customer's real KYC
 * tier, the approved policy's requirement shape and the platform's actual ability to assess
 * evidence. It exposes no internal identifiers, no threshold values, no policy author/checker
 * metadata and no other customer's data. The `/customers/me/*` route policy already restricts every
 * path here to a CUSTOMER SELF principal, and this handler re-checks the principal type.
 */
@Controller('customers/me/kyc')
export class CustomerKycController {
  constructor(private readonly view: CustomerKycViewService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@Req() req: AuthenticatedRequest): Promise<CustomerKycView> {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'CUSTOMER' || !principal.customerId) {
      throw new UnauthorizedException('Customer authentication required');
    }
    return this.view.view(principal.customerId);
  }
}
