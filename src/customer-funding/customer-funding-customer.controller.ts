import { Controller, Get, Query, Req, UnauthorizedException, ForbiddenException } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CustomerFundingService } from './customer-funding.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller()
export class CustomerFundingCustomerController {
  constructor(private readonly fundingService: CustomerFundingService) {}

  @Get('customers/me/funding-history')
  async fundingHistory(
    @Req() req: AuthenticatedRequest,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const principal = this.requireCustomer(req);
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const rawLimit = Number.parseInt(limitRaw ?? '20', 10) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const result = await this.fundingService.listForCustomer(principal.customerId!, page, limit);
    // Return same shape as A25 history: items + pagination, but safe projection
    return result;
  }

  @Get('customers/me/funding-requests')
  async fundingRequestsAlias(
    @Req() req: AuthenticatedRequest,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    return this.fundingHistory(req, pageRaw, limitRaw);
  }

  private requireCustomer(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type !== 'CUSTOMER') throw new ForbiddenException('Customer access required');
    if (!principal.customerId) throw new ForbiddenException('Customer principal missing customerId');
    return principal;
  }
}
