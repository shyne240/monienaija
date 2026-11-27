import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Optional,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { KycWorkforceReviewService } from './kyc-workforce-review.service';
import {
  KycWorkforceVerificationService,
  type WorkforceIdentityVerificationCommand,
} from './kyc-workforce-verification.service';

interface WorkforceRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/kyc/review-workspace')
export class KycWorkforceReviewController {
  constructor(
    private readonly reviews: KycWorkforceReviewService,
    @Optional() private readonly verifications?: KycWorkforceVerificationService,
  ) {}

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
  async inspectCustomer(@Req() req: WorkforceRequest, @Param('customerId') customerId: string) {
    const dossier = await this.reviews.inspectCustomer(req.authorizationPrincipal, customerId);
    return {
      ...dossier,
      consentNotice: this.verifications?.consentNotice() ?? null,
    };
  }

  @Post('customers/:customerId/verify-identity')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  verifyIdentity(
    @Req() req: WorkforceRequest,
    @Param('customerId') customerId: string,
    @Body() body: WorkforceIdentityVerificationCommand,
  ) {
    if (!this.verifications) {
      throw new ServiceUnavailableException('Workforce KYC verification is unavailable');
    }
    return this.verifications.verifyRegisteredIdentity(
      req.authorizationPrincipal,
      customerId,
      body,
    );
  }
}
