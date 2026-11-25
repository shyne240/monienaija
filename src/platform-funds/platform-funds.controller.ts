import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  AddTimingItemDto,
  CreateComparisonDto,
  ListComparisonsQueryDto,
  PreviewComparisonDto,
  ReviewComparisonDto,
  SubmitComparisonDto,
  UpdateComparisonDto,
} from './dto/platform-funds.dto';
import { PlatformFundsService } from './platform-funds.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const WORKFORCE_TYPES = ['OPERATOR', 'SERVICE', 'PRIVILEGED'] as const;

/**
 * Finance → Reconciliation, "Platform Funds vs. Bank Balance".
 *
 * Every route is registered in `route-policy-registry.ts` (catalogue gate: `ledger.view`) and
 * re-checks the same function here. Writes are additionally role-gated in the service:
 * recording/submitting requires FINANCE_PREPARER with an MFA session; reviewing requires an
 * independent FINANCE_CONTROLLER (self-approval is prohibited). Nothing here moves money and
 * nothing posts a ledger adjustment — the surface records evidence and a governed sign-off.
 */
@Controller('internal/finance-operations/platform-funds')
export class PlatformFundsController {
  constructor(
    private readonly platformFunds: PlatformFundsService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('scope')
  async scope(@Req() req: AuthenticatedRequest) {
    const principal = await this.require(req, 'ledger.view', 'FINANCE_PLATFORM_FUNDS_SCOPE');
    return this.platformFunds.scopeFor(principal);
  }

  @Get('settlement-accounts')
  async settlementAccounts(@Req() req: AuthenticatedRequest) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_PLATFORM_FUNDS_SETTLEMENT_ACCOUNTS',
    );
    return this.platformFunds.listSettlementAccounts(principal);
  }

  @Get('comparisons')
  async comparisons(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListComparisonsQueryDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_PLATFORM_FUNDS_COMPARISONS',
    );
    return this.platformFunds.list(principal, query);
  }

  @Post('comparisons/preview')
  async preview(@Req() req: AuthenticatedRequest, @Body() dto: PreviewComparisonDto) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_PLATFORM_FUNDS_PREVIEW',
    );
    return this.platformFunds.preview(principal, dto);
  }

  @Post('comparisons')
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateComparisonDto) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_PLATFORM_FUNDS_COMPARISON_CREATE',
    );
    return this.platformFunds.create(principal, dto);
  }

  @Get('comparisons/:comparisonId')
  async detail(
    @Req() req: AuthenticatedRequest,
    @Param('comparisonId') comparisonId: string,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_PLATFORM_FUNDS_COMPARISON',
    );
    return this.platformFunds.get(principal, comparisonId);
  }

  @Patch('comparisons/:comparisonId')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('comparisonId') comparisonId: string,
    @Body() dto: UpdateComparisonDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_PLATFORM_FUNDS_COMPARISON_UPDATE',
    );
    return this.platformFunds.update(principal, comparisonId, dto);
  }

  @Post('comparisons/:comparisonId/timing-items')
  async addTimingItem(
    @Req() req: AuthenticatedRequest,
    @Param('comparisonId') comparisonId: string,
    @Body() dto: AddTimingItemDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_PLATFORM_FUNDS_TIMING_ITEM_ADD',
    );
    return this.platformFunds.addTimingItem(principal, comparisonId, dto);
  }

  @Delete('comparisons/:comparisonId/timing-items/:itemId')
  async removeTimingItem(
    @Req() req: AuthenticatedRequest,
    @Param('comparisonId') comparisonId: string,
    @Param('itemId') itemId: string,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_PLATFORM_FUNDS_TIMING_ITEM_REMOVE',
    );
    return this.platformFunds.removeTimingItem(principal, comparisonId, itemId);
  }

  @Post('comparisons/:comparisonId/submit')
  async submit(
    @Req() req: AuthenticatedRequest,
    @Param('comparisonId') comparisonId: string,
    @Body() dto: SubmitComparisonDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_PLATFORM_FUNDS_COMPARISON_SUBMIT',
    );
    return this.platformFunds.submit(principal, comparisonId, dto);
  }

  @Post('comparisons/:comparisonId/review')
  async review(
    @Req() req: AuthenticatedRequest,
    @Param('comparisonId') comparisonId: string,
    @Body() dto: ReviewComparisonDto,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_PLATFORM_FUNDS_COMPARISON_REVIEW',
    );
    return this.platformFunds.review(principal, comparisonId, dto);
  }

  @Get('comparisons/:comparisonId/snapshots')
  async snapshots(
    @Req() req: AuthenticatedRequest,
    @Param('comparisonId') comparisonId: string,
  ) {
    const principal = await this.require(
      req,
      'ledger.view',
      'FINANCE_PLATFORM_FUNDS_SNAPSHOTS',
    );
    return this.platformFunds.snapshots(principal, comparisonId);
  }

  private async require(
    req: AuthenticatedRequest,
    functionCode: string,
    resourceType: string,
  ): Promise<AuthorizationPrincipal> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    await this.auth.requireFunction(principal, functionCode, resourceType, WORKFORCE_TYPES);
    return principal;
  }
}
