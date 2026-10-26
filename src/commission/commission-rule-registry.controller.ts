import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
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
  CommercialRuleGovernanceService,
  GovernedChangeRequestView,
} from '../authorization/commercial-rule-governance.service';

import type {
  CommissionCalculationBasis,
  CommissionCalculationModel,
  CommissionRecipientType,
  CommissionTier,
} from './commission-rule.entity';
import { CommissionRuleRegistryService } from './commission-rule-registry.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

interface CommissionRuleCreateBody {
  reason?: string;
  productCode?: string;
  currency?: string;
  recipientType?: CommissionRecipientType;
  calculationModel?: CommissionCalculationModel;
  calculationBasis?: CommissionCalculationBasis;
  flatCommissionMinor?: string | number | null;
  percentageBps?: number | null;
  minimumCommissionMinor?: string | number | null;
  maximumCommissionMinor?: string | number | null;
  tiers?: CommissionTier[] | null;
  agentClassId?: string | null;
  agentId?: string | null;
  aggregatorId?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  priority?: number;
  isActive?: boolean;
}

interface CommissionRuleUpdateBody {
  reason?: string;
  calculationBasis?: CommissionCalculationBasis;
  flatCommissionMinor?: string | number | null;
  percentageBps?: number | null;
  minimumCommissionMinor?: string | number | null;
  maximumCommissionMinor?: string | number | null;
  tiers?: CommissionTier[] | null;
  effectiveTo?: string | null;
  priority?: number;
  isActive?: boolean;
  version?: number;
}

/**
 * V1-COMMISSION-01 — workforce-only commission-rule administration surface (schema
 * foundation; no runtime charging exists anywhere).
 *
 * Routes (all under /api/v1/internal):
 *   GET   commission-rules          — list (filters: productCode, currency, recipientType, isActive)
 *   GET   commission-rules/:id      — single safe projection
 *   POST  commission-rules          — create a rule DEFINITION (never charges anything)
 *   PATCH commission-rules/:id      — version-checked, audited updates
 *
 * No DELETE route: rules are deactivated (isActive=false) or ended (effectiveTo), never
 * erased. RoutePolicyRegistry maps /api/v1/internal/commission-rules to
 * WORKFORCE_SESSION (OPERATOR/SERVICE/PRIVILEGED); the checks below are defense-in-depth.
 */
@Controller('internal')
export class CommissionRuleRegistryController {
  constructor(
    private readonly service: CommissionRuleRegistryService,
    private readonly governance: CommercialRuleGovernanceService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('commission-rules')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('productCode') productCode?: string,
    @Query('currency') currency?: string,
    @Query('recipientType') recipientType?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'commission_rule.view');
    else this.requireWorkforce(req);
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
      recipientType: recipientType === undefined || recipientType.trim() === '' ? undefined : recipientType.trim().toUpperCase(),
      isActive: isActiveBool,
      page: p,
      limit: l,
    });
  }

  @Get('commission-rules/:id')
  async getOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'commission_rule.view');
    else this.requireWorkforce(req);
    return this.service.getRule(id);
  }

  /** Maker side (P0-A): PENDING commission_rule.create request — never a direct write. */
  @Post('commission-rules')
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: CommissionRuleCreateBody,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ): Promise<GovernedChangeRequestView> {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'commission_rule.create');
    else this.requireWorkforce(req);
    return this.governance.requestChange({
      principal: req.authorizationPrincipal!,
      action: 'COMMISSION_RULE_CREATE',
      payload: this.buildCreatePayload(body),
      reason: this.requireReason(body),
      expiresInSeconds: this.parseExpiry(expiresInSeconds),
    });
  }

  /** Checker-execution side (P0-A): applies an approved commission_rule.create request. */
  @Post('commission-rules/changes/:approvalId/execute-create')
  @HttpCode(HttpStatus.CREATED)
  async executeCreate(
    @Req() req: AuthenticatedRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: CommissionRuleCreateBody,
  ) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'commission_rule.create');
    else this.requireWorkforce(req);
    return this.governance.executeChange({
      principal: req.authorizationPrincipal!,
      action: 'COMMISSION_RULE_CREATE',
      approvalId,
      payload: this.buildCreatePayload(body),
      write: () => this.service.createRule(this.buildCreateCommand(body), this.actorOf(req)),
    });
  }

  /** Maker side (P0-A): PENDING commission_rule.modify request. */
  @Patch('commission-rules/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: CommissionRuleUpdateBody,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ): Promise<GovernedChangeRequestView> {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'commission_rule.modify');
    else this.requireWorkforce(req);
    return this.governance.requestChange({
      principal: req.authorizationPrincipal!,
      action: 'COMMISSION_RULE_MODIFY',
      resourceId: id,
      payload: this.buildUpdatePayload(body),
      reason: this.requireReason(body),
      expiresInSeconds: this.parseExpiry(expiresInSeconds),
    });
  }

  /** Checker-execution side (P0-A): applies an approved commission_rule.modify request. */
  @Post('commission-rules/changes/:approvalId/execute-modify')
  @HttpCode(HttpStatus.OK)
  async executeModify(
    @Req() req: AuthenticatedRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: CommissionRuleUpdateBody,
  ) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'commission_rule.modify');
    else this.requireWorkforce(req);
    return this.governance.executeChange({
      principal: req.authorizationPrincipal!,
      action: 'COMMISSION_RULE_MODIFY',
      approvalId,
      payload: this.buildUpdatePayload(body),
      write: (resourceId) =>
        this.service.updateRule(resourceId!, this.buildUpdateCommand(body), this.actorOf(req)),
    });
  }

  private isWorkforce(req?: AuthenticatedRequest): boolean {
    const t = req?.authorizationPrincipal?.type;
    return t === 'SUPPORT' || t === 'OPERATOR' || t === 'SERVICE' || t === 'PRIVILEGED';
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'commission_rule_registry', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
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

  private buildCreateCommand(body: CommissionRuleCreateBody) {
    return {
      productCode: body.productCode ?? '',
      currency: body.currency,
      recipientType: body.recipientType as CommissionRecipientType,
      calculationModel: body.calculationModel as CommissionCalculationModel,
      calculationBasis: body.calculationBasis as CommissionCalculationBasis,
      flatCommissionMinor: body.flatCommissionMinor,
      percentageBps: body.percentageBps,
      minimumCommissionMinor: body.minimumCommissionMinor,
      maximumCommissionMinor: body.maximumCommissionMinor,
      tiers: body.tiers,
      agentClassId: body.agentClassId,
      agentId: body.agentId,
      aggregatorId: body.aggregatorId,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo,
      priority: body.priority,
      isActive: body.isActive,
    };
  }

  private buildCreatePayload(body: CommissionRuleCreateBody) {
    return { ...this.buildCreateCommand(body), reason: this.requireReason(body) };
  }

  private buildUpdateCommand(body: CommissionRuleUpdateBody) {
    if (typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 1) {
      throw new BadRequestException('version is required for updates (optimistic concurrency)');
    }
    return {
      calculationBasis: body.calculationBasis,
      flatCommissionMinor: body.flatCommissionMinor,
      percentageBps: body.percentageBps,
      minimumCommissionMinor: body.minimumCommissionMinor,
      maximumCommissionMinor: body.maximumCommissionMinor,
      tiers: body.tiers,
      effectiveTo: body.effectiveTo,
      priority: body.priority,
      isActive: body.isActive,
      version: body.version,
    };
  }

  private buildUpdatePayload(body: CommissionRuleUpdateBody) {
    return { ...this.buildUpdateCommand(body), reason: this.requireReason(body) };
  }

  private requireReason(body: { reason?: unknown }): string {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason || reason.length > 500) {
      throw new BadRequestException('reason must contain 1 to 500 characters');
    }
    return reason;
  }

  private parseExpiry(raw?: string): number | undefined {
    if (raw === undefined || raw === '') return undefined;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 60 || parsed > 86_400) {
      throw new BadRequestException('expiresInSeconds must be an integer between 60 and 86400');
    }
    return parsed;
  }
}
