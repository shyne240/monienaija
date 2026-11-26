import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { KycWorkforceReviewService } from './kyc-workforce-review.service';

interface WorkforceRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/kyc/review-workspace')
export class KycWorkforceReviewController {
  constructor(private readonly reviews: KycWorkforceReviewService) {}

  @Get('queue')
  @Header('Cache-Control', 'no-store')
  queue(
    @Req() req: WorkforceRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('level') level?: string,
    @Query('institutionId') institutionId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reviews.listQueue(req.authorizationPrincipal, {
      search,
      status,
      level,
      institutionId,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get('customers/:customerId')
  @Header('Cache-Control', 'no-store')
  inspectCustomer(@Req() req: WorkforceRequest, @Param('customerId') customerId: string) {
    return this.reviews.inspectCustomer(req.authorizationPrincipal, customerId);
  }
}
