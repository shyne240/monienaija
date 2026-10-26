import { BadRequestException, Controller, ForbiddenException, Get, Query, Req, UnauthorizedException } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';

import { FeeRuleResolverService } from './fee-rule-resolver.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-COMMERCIAL-04 — workforce-only, READ-ONLY fee rule resolution diagnostic.
 *
 *   GET /api/v1/internal/fee-rules/resolve?productCode=&currency=&at=
 *
 * Returns { status: 'RESOLVED' | 'NOT_CONFIGURED' | 'AMBIGUOUS', ... } — the service contract,
 * never charges or writes anything. RoutePolicyRegistry already maps the
 * /api/v1/internal/fee-rules prefix to WORKFORCE_SESSION (OPERATOR/SERVICE/PRIVILEGED); the
 * checks below are defense-in-depth. The static `resolve` segment wins over the registry's
 * parametric `fee-rules/:id` route under find-my-way's static-priority routing.
 *
 * NOT_CONFIGURED is returned with 200 (absence of configuration is a normal V1 state —
 * zero production fee rules exist). AMBIGUOUS is also returned with 200 carrying the explicit
 * conflict report; it is a deterministic resolution outcome, not a server fault.
 */
@Controller('internal')
export class FeeRuleResolverController {
  constructor(private readonly resolver: FeeRuleResolverService) {}

  @Get('fee-rules/resolve')
  async resolve(
    @Req() req: AuthenticatedRequest,
    @Query('productCode') productCode?: string,
    @Query('currency') currency?: string,
    @Query('at') at?: string,
  ) {
    this.requireWorkforce(req);
    if (!productCode) throw new BadRequestException('productCode is required');
    if (currency !== undefined && currency !== '' && !/^[A-Za-z]{3}$/.test(currency.trim())) {
      throw new BadRequestException('currency must be a 3-letter ISO code');
    }
    if (at !== undefined && at !== '' && Number.isNaN(new Date(at).getTime())) {
      throw new BadRequestException('at must be a valid ISO timestamp');
    }
    const resolution = await this.resolver.resolve({
      productCode,
      currency: currency === undefined || currency === '' ? undefined : currency,
      at: at === undefined || at === '' ? undefined : new Date(at),
    });
    return {
      status: resolution.status,
      productCode: resolution.productCode,
      currency: resolution.currency,
      evaluatedAt: resolution.evaluatedAt.toISOString(),
      ...(resolution.rule
        ? {
            rule: {
              ruleId: resolution.rule.ruleId,
              ruleVersion: resolution.rule.ruleVersion,
              flatFeeMinor: resolution.rule.flatFeeMinor,
              percentageBps: resolution.rule.percentageBps,
              minimumFeeMinor: resolution.rule.minimumFeeMinor,
              maximumFeeMinor: resolution.rule.maximumFeeMinor,
              vatBps: resolution.rule.vatBps,
              effectiveFrom: resolution.rule.effectiveFrom.toISOString(),
              effectiveTo: resolution.rule.effectiveTo === null ? null : resolution.rule.effectiveTo.toISOString(),
              priority: resolution.rule.priority,
            },
          }
        : {}),
      ...(resolution.ambiguousRuleIds
        ? { ambiguousRuleIds: resolution.ambiguousRuleIds, ambiguousPriority: resolution.ambiguousPriority }
        : {}),
    };
  }

  private requireWorkforce(req: AuthenticatedRequest): void {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const allowed = ['OPERATOR', 'SERVICE', 'PRIVILEGED'];
    if (!allowed.includes((principal as { type?: string }).type as string)) {
      throw new ForbiddenException('Fee-rule resolution diagnostics are workforce-only — OPERATOR/SERVICE/PRIVILEGED only');
    }
  }
}
