import { BadRequestException, Controller, ForbiddenException, Get, Query, Req, UnauthorizedException } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';

import type { RewardCustomerKycLevel } from './reward-rule.entity';
import { RewardRuleResolverService } from './reward-rule-resolver.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-REWARD-01 — workforce-only, READ-ONLY reward rule resolution diagnostic.
 *
 *   GET /api/v1/internal/reward-rules/resolve?productCode=&currency=&principalMinor=&feeMinor=
 *       &customerId=&customerKycLevel=&agentId=&agentClassId=&campaignCode=&at=
 *
 * Returns { status: 'NOT_CONFIGURED' | 'GRANTED', grants, ruleRefs } — the service
 * contract; it never credits or writes anything. RoutePolicyRegistry maps the
 * /api/v1/internal/reward-rules prefix to WORKFORCE_SESSION (OPERATOR/SERVICE/
 * PRIVILEGED); the checks below are defense-in-depth. The static `resolve` segment
 * wins over the registry's parametric `reward-rules/:id` route under find-my-way's
 * static-priority routing.
 *
 * NOT_CONFIGURED is returned with 200 (zero production reward rules exist — absence of
 * configuration is the normal V1 state). AMBIGUOUS/BASE_UNAVAILABLE configurations
 * fail closed with 409/400 — never a silent choice.
 */
@Controller('internal')
export class RewardRuleResolverController {
  constructor(private readonly resolver: RewardRuleResolverService) {}

  @Get('reward-rules/resolve')
  async resolve(
    @Req() req: AuthenticatedRequest,
    @Query('productCode') productCode?: string,
    @Query('currency') currency?: string,
    @Query('principalMinor') principalMinor?: string,
    @Query('feeMinor') feeMinor?: string,
    @Query('customerId') customerId?: string,
    @Query('customerKycLevel') customerKycLevel?: string,
    @Query('agentId') agentId?: string,
    @Query('agentClassId') agentClassId?: string,
    @Query('campaignCode') campaignCode?: string,
    @Query('at') at?: string,
  ) {
    this.requireWorkforce(req);
    if (!productCode) throw new BadRequestException('productCode is required');
    if (!principalMinor || !/^\d+$/.test(principalMinor.trim())) {
      throw new BadRequestException('principalMinor is required (non-negative integer minor units)');
    }
    if (currency !== undefined && currency !== '' && !/^[A-Za-z]{3}$/.test(currency.trim())) {
      throw new BadRequestException('currency must be a 3-letter ISO code');
    }
    if (feeMinor !== undefined && feeMinor !== '' && !/^\d+$/.test(feeMinor.trim())) {
      throw new BadRequestException('feeMinor must be a non-negative integer in minor units');
    }
    if (customerKycLevel !== undefined && customerKycLevel !== '' && !/^(NONE|LEVEL_[123])$/.test(customerKycLevel.trim())) {
      throw new BadRequestException('customerKycLevel must be one of NONE, LEVEL_1, LEVEL_2, LEVEL_3 (existing CustomerKycLevel vocabulary)');
    }
    if (at !== undefined && at !== '' && Number.isNaN(new Date(at).getTime())) {
      throw new BadRequestException('at must be a valid ISO timestamp');
    }
    const resolution = await this.resolver.resolve(
      {
        productCode,
        currency: currency === undefined || currency === '' ? 'NGN' : currency,
        at: at === undefined || at === '' ? undefined : new Date(at),
        customerId: this.blank(customerId),
        customerKycLevel: this.blank(customerKycLevel) as RewardCustomerKycLevel | null,
        agentClassId: this.blank(agentClassId),
        agentId: this.blank(agentId),
        campaignCode: this.blank(campaignCode),
      },
      {
        principalMinor: principalMinor.trim(),
        feeMinor: feeMinor === undefined || feeMinor === '' ? null : feeMinor.trim(),
      },
    );
    return {
      status: resolution.status,
      productCode: resolution.productCode,
      currency: resolution.currency,
      evaluatedAt: resolution.evaluatedAt.toISOString(),
      grants: resolution.grants.map((g) => ({
        beneficiaryType: g.beneficiaryType,
        beneficiaryId: g.beneficiaryId,
        rewardType: g.rewardType,
        amountMinor: g.amountMinor,
        currency: g.currency,
        basis: g.basis,
        baseAmountMinor: g.baseAmountMinor,
        calculationModel: g.calculationModel,
        appliedParameters: g.appliedParameters,
        ruleId: g.ruleId,
        ruleVersion: g.ruleVersion,
        priority: g.priority,
        effectiveFrom: g.effectiveFrom.toISOString(),
        effectiveTo: g.effectiveTo === null ? null : g.effectiveTo.toISOString(),
        campaignCode: g.campaignCode,
        targeting: g.targeting,
      })),
      ruleRefs: resolution.ruleRefs,
    };
  }

  private blank(v?: string): string | null {
    if (v === undefined || v.trim() === '') return null;
    return v.trim();
  }

  private requireWorkforce(req: AuthenticatedRequest): void {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const allowed = ['OPERATOR', 'SERVICE', 'PRIVILEGED'];
    if (!allowed.includes((principal as { type?: string }).type as string)) {
      throw new ForbiddenException('Reward-rule resolution diagnostics are workforce-only — OPERATOR/SERVICE/PRIVILEGED only');
    }
  }
}
