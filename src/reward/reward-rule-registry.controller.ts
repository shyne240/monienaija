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
  RewardBeneficiaryType,
  RewardCalculationBasis,
  RewardCalculationModel,
  RewardCustomerKycLevel,
  RewardGrantType,
  RewardTier,
} from './reward-rule.entity';
import { RewardRuleRegistryService } from './reward-rule-registry.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

interface RewardRuleCreateBody {
  reason?: string;
  productCode?: string;
  currency?: string;
  beneficiaryType?: RewardBeneficiaryType;
  rewardType?: RewardGrantType;
  calculationModel?: RewardCalculationModel;
  calculationBasis?: RewardCalculationBasis;
  flatRewardMinor?: string | number | null;
  percentageBps?: number | null;
  minimumRewardMinor?: string | number | null;
  maximumRewardMinor?: string | number | null;
  tiers?: RewardTier[] | null;
  customerId?: string | null;
  customerKycLevel?: RewardCustomerKycLevel | null;
  agentClassId?: string | null;
  agentId?: string | null;
  campaignCode?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  priority?: number;
  isActive?: boolean;
}

interface RewardRuleUpdateBody {
  reason?: string;
  calculationBasis?: RewardCalculationBasis;
  flatRewardMinor?: string | number | null;
  percentageBps?: number | null;
  minimumRewardMinor?: string | number | null;
  maximumRewardMinor?: string | number | null;
  tiers?: RewardTier[] | null;
  effectiveTo?: string | null;
  priority?: number;
  isActive?: boolean;
  version?: number;
}

/**
 * V1-REWARD-01 — workforce-only reward-rule administration surface (schema foundation;
 * no runtime crediting exists anywhere).
 *
 * Routes (all under /api/v1/internal):
 *   GET   reward-rules          — list (filters: productCode, currency, beneficiaryType, isActive)
 *   GET   reward-rules/:id      — single safe projection
 *   POST  reward-rules          — create a rule DEFINITION (never credits anything)
 *   PATCH reward-rules/:id      — version-checked, audited updates
 *
 * No DELETE route: rules are deactivated (isActive=false) or ended (effectiveTo), never
 * erased. RoutePolicyRegistry maps /api/v1/internal/reward-rules to WORKFORCE_SESSION
 * (OPERATOR/SERVICE/PRIVILEGED); the checks below are defense-in-depth.
 */
@Controller('internal')
export class RewardRuleRegistryController {
  constructor(
    private readonly service: RewardRuleRegistryService,
    private readonly governance: CommercialRuleGovernanceService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('reward-rules')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('productCode') productCode?: string,
    @Query('currency') currency?: string,
    @Query('beneficiaryType') beneficiaryType?: string,
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
      beneficiaryType: beneficiaryType === undefined || beneficiaryType.trim() === '' ? undefined : beneficiaryType.trim().toUpperCase(),
      isActive: isActiveBool,
      page: p,
      limit: l,
    });
  }

  @Get('reward-rules/:id')
  async getOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    this.requireWorkforce(req);
    return this.service.getRule(id);
  }

  /** Maker side (P0-A): PENDING reward_rule.create request — never a direct write. */
  @Post('reward-rules')
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: RewardRuleCreateBody,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ): Promise<GovernedChangeRequestView> {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'reward_rule.create');
    return this.governance.requestChange({
      principal: req.authorizationPrincipal!,
      action: 'REWARD_RULE_CREATE',
      payload: this.buildCreatePayload(body),
      reason: this.requireReason(body),
      expiresInSeconds: this.parseExpiry(expiresInSeconds),
    });
  }

  /** Checker-execution side (P0-A): applies an approved reward_rule.create request. */
  @Post('reward-rules/changes/:approvalId/execute-create')
  @HttpCode(HttpStatus.CREATED)
  async executeCreate(
    @Req() req: AuthenticatedRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: RewardRuleCreateBody,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'reward_rule.create');
    return this.governance.executeChange({
      principal: req.authorizationPrincipal!,
      action: 'REWARD_RULE_CREATE',
      approvalId,
      payload: this.buildCreatePayload(body),
      write: () => this.service.createRule(this.buildCreateCommand(body), this.actorOf(req)),
    });
  }

  /** Maker side (P0-A): PENDING reward_rule.modify request. */
  @Patch('reward-rules/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: RewardRuleUpdateBody,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ): Promise<GovernedChangeRequestView> {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'reward_rule.modify');
    return this.governance.requestChange({
      principal: req.authorizationPrincipal!,
      action: 'REWARD_RULE_MODIFY',
      resourceId: id,
      payload: this.buildUpdatePayload(body),
      reason: this.requireReason(body),
      expiresInSeconds: this.parseExpiry(expiresInSeconds),
    });
  }

  /** Checker-execution side (P0-A): applies an approved reward_rule.modify request. */
  @Post('reward-rules/changes/:approvalId/execute-modify')
  @HttpCode(HttpStatus.OK)
  async executeModify(
    @Req() req: AuthenticatedRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: RewardRuleUpdateBody,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'reward_rule.modify');
    return this.governance.executeChange({
      principal: req.authorizationPrincipal!,
      action: 'REWARD_RULE_MODIFY',
      approvalId,
      payload: this.buildUpdatePayload(body),
      write: (resourceId) =>
        this.service.updateRule(resourceId!, this.buildUpdateCommand(body), this.actorOf(req)),
    });
  }

  private requireWorkforce(req: AuthenticatedRequest): void {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    const allowed = ['OPERATOR', 'SERVICE', 'PRIVILEGED'];
    if (!allowed.includes(principal.type as string)) {
      throw new ForbiddenException('Privileged access required — OPERATOR/SERVICE/PRIVILEGED only');
    }
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'reward_rule_registry', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }

  private buildCreateCommand(body: RewardRuleCreateBody) {
    return {
      productCode: body.productCode ?? '',
      currency: body.currency,
      beneficiaryType: body.beneficiaryType as RewardBeneficiaryType,
      rewardType: body.rewardType as RewardGrantType,
      calculationModel: body.calculationModel as RewardCalculationModel,
      calculationBasis: body.calculationBasis as RewardCalculationBasis,
      flatRewardMinor: body.flatRewardMinor,
      percentageBps: body.percentageBps,
      minimumRewardMinor: body.minimumRewardMinor,
      maximumRewardMinor: body.maximumRewardMinor,
      tiers: body.tiers,
      customerId: body.customerId,
      customerKycLevel: body.customerKycLevel,
      agentClassId: body.agentClassId,
      agentId: body.agentId,
      campaignCode: body.campaignCode,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo,
      priority: body.priority,
      isActive: body.isActive,
    };
  }

  private buildCreatePayload(body: RewardRuleCreateBody) {
    return { ...this.buildCreateCommand(body), reason: this.requireReason(body) };
  }

  private buildUpdateCommand(body: RewardRuleUpdateBody) {
    if (typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 1) {
      throw new BadRequestException('version is required for updates (optimistic concurrency)');
    }
    return {
      calculationBasis: body.calculationBasis,
      flatRewardMinor: body.flatRewardMinor,
      percentageBps: body.percentageBps,
      minimumRewardMinor: body.minimumRewardMinor,
      maximumRewardMinor: body.maximumRewardMinor,
      tiers: body.tiers,
      effectiveTo: body.effectiveTo,
      priority: body.priority,
      isActive: body.isActive,
      version: body.version,
    };
  }

  private buildUpdatePayload(body: RewardRuleUpdateBody) {
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
