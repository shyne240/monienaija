import { Controller, Get, Header, Req } from '@nestjs/common';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { KycTierTransitionService } from './kyc-tier-transition.service';
@Controller('internal/kyc/tier-reviews')
export class KycTierReviewController {
  constructor(private readonly transitions: KycTierTransitionService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  reviews(@Req() req: { authorizationPrincipal?: AuthorizationPrincipal }) {
    return this.transitions.reviews(req.authorizationPrincipal);
  }
}
