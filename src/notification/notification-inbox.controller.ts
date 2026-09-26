import { Controller, Get, Query, Req, UnauthorizedException } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';

import { NotificationInboxService } from './notification-inbox.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller()
export class NotificationInboxController {
  constructor(private readonly inboxService: NotificationInboxService) {}

  @Get('customers/me/notifications')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const principal = this.requireCustomerPrincipal(req);
    const p = page ? parseInt(page, 10) : 1;
    const l = limit ? parseInt(limit, 10) : 20;
    // Use service's normalization (will throw 400 if invalid)
    return this.inboxService.listForCustomer(principal.customerId!, p, l);
  }

  private requireCustomerPrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'CUSTOMER' || !principal.customerId) {
      throw new UnauthorizedException('Customer authentication required');
    }
    return principal;
  }
}
