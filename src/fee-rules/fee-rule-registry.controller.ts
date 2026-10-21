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

import { FeeRuleRegistryService } from './fee-rule-registry.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/** Maker-request / execute bodies (P0-A): reason is fingerprint-bound with the change fields. */
interface FeeRuleCreateBody {
  reason?: string;
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
}

interface FeeRuleUpdateBody {
  reason?: string;
  flatFeeMinor?: string | number | null;
  percentageBps?: number | null;
  minimumFeeMinor?: string | number | null;
  maximumFeeMinor?: string | number | null;
  vatBps?: number | null;
  effectiveTo?: string | null;
  priority?: number;
  isActive?: boolean;
  version?: number;
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
 * below are defense-in-depth with per-function authorization.
 */
@Controller('internal')
export class FeeRuleRegistryController {
  constructor(
    private readonly service: FeeRuleRegistryService,
    private readonly governance: CommercialRuleGovernanceService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('fee-rules')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('productCode') productCode?: string,
    @Query('currency') currency?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'fee_rule.view');
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
      isActive: isActiveBool,
      page: p,
      limit: l,
    });
  }

  @Get('fee-rules/:id')
  async getOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'fee_rule.view');
    else this.requireWorkforce(req);
    return this.service.getRule(id);
  }

  /**
   * Maker side (P0-A): creates a PENDING fee_rule.create maker-checker request — never a direct
   * write. The fingerprint is computed server-side from the actual change payload (including the
   * reason) via the canonicalization rules; a FINANCE_CONTROLLER then approves it through the
   * approvals surface and it is applied by executeCreate below.
   */
  @Post('fee-rules')
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: FeeRuleCreateBody,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ): Promise<GovernedChangeRequestView> {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'fee_rule.create');
    else this.requireWorkforce(req);
    return this.governance.requestChange({
      principal: req.authorizationPrincipal!,
      action: 'FEE_RULE_CREATE',
      payload: this.buildCreatePayload(body),
      reason: this.requireReason(body),
      expiresInSeconds: this.parseExpiry(expiresInSeconds),
    });
  }

  /** Checker-execution side (P0-A): applies an approved fee_rule.create request. */
  @Post('fee-rules/changes/:approvalId/execute-create')
  @HttpCode(HttpStatus.CREATED)
  async executeCreate(
    @Req() req: AuthenticatedRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: FeeRuleCreateBody,
  ) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'fee_rule.create');
    else this.requireWorkforce(req);
    return this.governance.executeChange({
      principal: req.authorizationPrincipal!,
      action: 'FEE_RULE_CREATE',
      approvalId,
      payload: this.buildCreatePayload(body),
      write: () => this.service.createRule(this.buildCreateCommand(body), this.actorOf(req)),
    });
  }

  /**
   * Maker side (P0-A): PENDING fee_rule.modify request (optimistic-concurrency version travels
   * inside the fingerprint-bound payload and is re-verified by updateRule at execution).
   */
  @Patch('fee-rules/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: FeeRuleUpdateBody,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ): Promise<GovernedChangeRequestView> {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'fee_rule.modify');
    else this.requireWorkforce(req);
    return this.governance.requestChange({
      principal: req.authorizationPrincipal!,
      action: 'FEE_RULE_MODIFY',
      resourceId: id,
      payload: this.buildUpdatePayload(body),
      reason: this.requireReason(body),
      expiresInSeconds: this.parseExpiry(expiresInSeconds),
    });
  }

  /** Checker-execution side (P0-A): applies an approved fee_rule.modify request. */
  @Post('fee-rules/changes/:approvalId/execute-modify')
  @HttpCode(HttpStatus.OK)
  async executeModify(
    @Req() req: AuthenticatedRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: FeeRuleUpdateBody,
  ) {
    if (this.isWorkforce(req)) await this.requireFunction(req, 'fee_rule.modify');
    else this.requireWorkforce(req);
    return this.governance.executeChange({
      principal: req.authorizationPrincipal!,
      action: 'FEE_RULE_MODIFY',
      approvalId,
      payload: this.buildUpdatePayload(body),
      write: (resourceId) =>
        this.service.updateRule(
          resourceId!,
          this.buildUpdateCommand(body),
          this.actorOf(req),
        ),
    });
  }

  private isWorkforce(req?: AuthenticatedRequest): boolean {
    const t = req?.authorizationPrincipal?.type;
    return t === 'SUPPORT' || t === 'OPERATOR' || t === 'SERVICE' || t === 'PRIVILEGED';
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'fee_rule_registry', [
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

  /** Exact create-change fields that would be persisted (minus reason) — used for both phases. */
  private buildCreateCommand(body: FeeRuleCreateBody) {
    return {
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
    };
  }

  private buildCreatePayload(body: FeeRuleCreateBody) {
    return { ...this.buildCreateCommand(body), reason: this.requireReason(body) };
  }

  private buildUpdateCommand(body: FeeRuleUpdateBody) {
    if (typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 1) {
      throw new BadRequestException('version is required for updates (optimistic concurrency)');
    }
    return {
      flatFeeMinor: body.flatFeeMinor,
      percentageBps: body.percentageBps,
      minimumFeeMinor: body.minimumFeeMinor,
      maximumFeeMinor: body.maximumFeeMinor,
      vatBps: body.vatBps,
      effectiveTo: body.effectiveTo,
      priority: body.priority,
      isActive: body.isActive,
      version: body.version,
    };
  }

  private buildUpdatePayload(body: FeeRuleUpdateBody) {
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
