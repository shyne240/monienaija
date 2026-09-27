import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';

import { FeeRuleRegistryService } from './fee-rule-registry.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-COMMERCIAL-03 — workforce-only fee-rule administration surface (schema foundation).
 *
 * Routes (all under /api/v1/internal):
 *   GET   fee-rules          — list (filters: productCode, currency, isActive)
 *   GET   fee-rules/:id      — single safe projection
 *   POST  fee-rules          — create a rule DEFINITION (never charges anything)
 *   PATCH fee-rules/:id      — version-checked, audited updates
 *
 * No DELETE route: rules are deactivated (isActive=false) or ended (effectiveTo), never erased.
 * No customer-facing or agent-facing fee administration exists. RoutePolicyRegistry maps
 * /api/v1/internal/fee-rules to WORKFORCE_SESSION (OPERATOR/SERVICE/PRIVILEGED); the checks
 * below are defense-in-depth.
 */
@Controller('internal')
export class FeeRuleRegistryController {
  constructor(private readonly service: FeeRuleRegistryService) {}

  @Get('fee-rules')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('productCode') productCode?: string,
    @Query('currency') currency?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.requireWorkforce(req);
    const p = page !== undefined ? Number.parseInt(page, 10) : undefined;
    const l = limit !== undefined ? Number.parseInt(limit, 10) : undefined;
    if (page !== undefined && (Number.isNaN(p!) || !Number.isSafeInteger(p!))) throw new BadRequestException('page must be a positive integer');
    if (limit !== undefined && (Number.isNaN(l!) || !Number.isSafeInteger(l!))) throw new BadRequestException('limit must be between 1 and 100');
    let isActiveBool: boolean | undefined;
    if (isActive !== undefined && isActive !== '') {
      if (isActive === 'true') isActiveBool = true;
      else if (isActive === 'false') isActiveBool = false;
      else throw new BadRequestException('isActive must be true or false');
    }
    return this.service.listRules({
      productCode: this.clean(productCode),
      currency: this.clean(currency),
      isActive: isActiveBool,
      page: p,
      limit: l,
    });
  }

  @Get('fee-rules/:id')
  async getOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    this.requireWorkforce(req);
    return this.service.getRule(id);
  }

  @Post('fee-rules')
  async create(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      productCode?: string;
      currency?: string;
      flatFeeMinor?: string | number | null;
      percentageBps?: number | null;
      minimumFeeMinor?: string | number | null;
      maximumFeeMinor?: string | number | null;
      vatBps?: number | null;
      effectiveFrom?: string;
      effectiveTo?: string | null;
      priority?: number;
      isActive?: boolean;
    },
  ) {
    this.requireWorkforce(req);
    return this.service.createRule(
      {
        productCode: body.productCode ?? '',
        currency: body.currency,
        flatFeeMinor: body.flatFeeMinor,
        percentageBps: body.percentageBps,
        minimumFeeMinor: body.minimumFeeMinor,
        maximumFeeMinor: body.maximumFeeMinor,
        vatBps: body.vatBps,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        priority: body.priority,
        isActive: body.isActive,
      },
      this.actorOf(req),
    );
  }

  @Patch('fee-rules/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      flatFeeMinor?: string | number | null;
      percentageBps?: number | null;
      minimumFeeMinor?: string | number | null;
      maximumFeeMinor?: string | number | null;
      vatBps?: number | null;
      effectiveTo?: string | null;
      priority?: number;
      isActive?: boolean;
      version?: number;
    },
  ) {
    this.requireWorkforce(req);
    if (typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 1) {
      throw new BadRequestException('version is required for updates (optimistic concurrency)');
    }
    return this.service.updateRule(
      id,
      {
        flatFeeMinor: body.flatFeeMinor,
        percentageBps: body.percentageBps,
        minimumFeeMinor: body.minimumFeeMinor,
        maximumFeeMinor: body.maximumFeeMinor,
        vatBps: body.vatBps,
        effectiveTo: body.effectiveTo,
        priority: body.priority,
        isActive: body.isActive,
        version: body.version,
      },
      this.actorOf(req),
    );
  }

  private requireWorkforce(req: AuthenticatedRequest): void {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const allowed = ['OPERATOR', 'SERVICE', 'PRIVILEGED'];
    if (!allowed.includes(principal.type as string)) {
      throw new ForbiddenException('Privileged access required — OPERATOR/SERVICE/PRIVILEGED only');
    }
  }

  private actorOf(req: AuthenticatedRequest): string {
    const p = req.authorizationPrincipal as unknown as { principalId?: string; type?: string } | undefined;
    return p?.principalId ?? p?.type ?? 'workforce';
  }

  private clean(v?: string): string | undefined {
    if (v === undefined || v === null) return undefined;
    const t = v.trim();
    return t.length === 0 ? undefined : t.toUpperCase();
  }
}
