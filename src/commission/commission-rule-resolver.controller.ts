import { BadRequestException, Controller, ForbiddenException, Get, Query, Req, UnauthorizedException } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';

import { CommissionRuleResolverService } from './commission-rule-resolver.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-COMMISSION-01 — workforce-only, READ-ONLY commission rule resolution diagnostic.
 *
 *   GET /api/v1/internal/commission-rules/resolve?productCode=&currency=&principalMinor=&feeMinor=&agentId=&agentClassId=&aggregatorId=&at=
 *
 * Returns { status: 'NOT_CONFIGURED' | 'ALLOCATED', allocations, ruleRefs } — the service
 * contract; it never charges or writes anything. RoutePolicyRegistry maps the
 * /api/v1/internal/commission-rules prefix to WORKFORCE_SESSION (OPERATOR/SERVICE/
 * PRIVILEGED); the checks below are defense-in-depth. The static `resolve` segment wins
 * over the registry's parametric `commission-rules/:id` route under find-my-way's
 * static-priority routing.
 *
 * NOT_CONFIGURED is returned with 200 (zero production commission rules exist — absence
 * of configuration is the normal V1 state). AMBIGUOUS/BASE_UNAVAILABLE configurations
 * fail closed with 409/400 — never a silent choice.
 */
@Controller('internal')
export class CommissionRuleResolverController {
  constructor(private readonly resolver: CommissionRuleResolverService) {}

  @Get('commission-rules/resolve')
  async resolve(
    @Req() req: AuthenticatedRequest,
    @Query('productCode') productCode?: string,
    @Query('currency') currency?: string,
    @Query('principalMinor') principalMinor?: string,
    @Query('feeMinor') feeMinor?: string,
    @Query('agentId') agentId?: string,
    @Query('agentClassId') agentClassId?: string,
    @Query('aggregatorId') aggregatorId?: string,
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
    if (at !== undefined && at !== '' && Number.isNaN(new Date(at).getTime())) {
      throw new BadRequestException('at must be a valid ISO timestamp');
    }
    const resolution = await this.resolver.resolve(
      {
        productCode,
        currency: currency === undefined || currency === '' ? 'NGN' : currency,
        at: at === undefined || at === '' ? undefined : new Date(at),
        agentId: this.blank(agentId),
        agentClassId: this.blank(agentClassId),
        aggregatorId: this.blank(aggregatorId),
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
      allocations: resolution.allocations.map((a) => ({
        recipientType: a.recipientType,
        recipientId: a.recipientId,
        amountMinor: a.amountMinor,
        currency: a.currency,
        basis: a.basis,
        baseAmountMinor: a.baseAmountMinor,
        calculationModel: a.calculationModel,
        appliedParameters: a.appliedParameters,
        ruleId: a.ruleId,
        ruleVersion: a.ruleVersion,
        priority: a.priority,
        effectiveFrom: a.effectiveFrom.toISOString(),
        effectiveTo: a.effectiveTo === null ? null : a.effectiveTo.toISOString(),
        targeting: a.targeting,
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
      throw new ForbiddenException('Commission-rule resolution diagnostics are workforce-only — OPERATOR/SERVICE/PRIVILEGED only');
    }
  }
}
