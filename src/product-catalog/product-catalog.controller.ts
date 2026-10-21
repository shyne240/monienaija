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

import { ProductCatalogService } from './product-catalog.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

interface ProductCreateBody {
  reason?: string;
  code?: string;
  name?: string;
  description?: string | null;
  domain?: string;
  currency?: string;
  productScope?: string;
  status?: string;
  enabled?: boolean;
  configurationStatus?: string;
}

interface ProductUpdateBody {
  reason?: string;
  name?: string;
  description?: string | null;
  domain?: string;
  status?: string;
  enabled?: boolean;
  configurationStatus?: string;
  version?: number;
}

/**
 * V1-COMMERCIAL-02 — workforce-only product catalogue surface.
 *
 * Routes (all under /api/v1/internal):
 *   GET   products                 — list (filters: domain, status, enabled, configurationStatus, productScope)
 *   GET   products/:code           — single safe projection
 *   POST  products                 — register a future product (no commercial rates accepted)
 *   PATCH products/:code           — version-checked, audited catalogue updates
 *
 * No DELETE route: deprecation is a status transition, never erasure. No customer/agent-facing
 * product configuration endpoints exist. RoutePolicyRegistry maps /api/v1/internal/products to
 * WORKFORCE_SESSION (OPERATOR/SERVICE/PRIVILEGED); the checks below are defense-in-depth.
 */
@Controller('internal')
export class ProductCatalogController {
  constructor(
    private readonly service: ProductCatalogService,
    private readonly governance: CommercialRuleGovernanceService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('products')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('domain') domain?: string,
    @Query('status') status?: string,
    @Query('enabled') enabled?: string,
    @Query('configurationStatus') configurationStatus?: string,
    @Query('productScope') productScope?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.requireWorkforce(req);
    const p = page !== undefined ? Number.parseInt(page, 10) : undefined;
    const l = limit !== undefined ? Number.parseInt(limit, 10) : undefined;
    if (page !== undefined && (Number.isNaN(p!) || !Number.isSafeInteger(p!))) throw new BadRequestException('page must be a positive integer');
    if (limit !== undefined && (Number.isNaN(l!) || !Number.isSafeInteger(l!))) throw new BadRequestException('limit must be between 1 and 100');
    let enabledBool: boolean | undefined;
    if (enabled !== undefined && enabled !== '') {
      if (enabled === 'true') enabledBool = true;
      else if (enabled === 'false') enabledBool = false;
      else throw new BadRequestException('enabled must be true or false');
    }
    return this.service.listProducts({
      domain: this.clean(domain),
      status: this.clean(status),
      enabled: enabledBool,
      configurationStatus: this.clean(configurationStatus),
      productScope: this.clean(productScope),
      page: p,
      limit: l,
    });
  }

  @Get('products/:code')
  async getOne(@Req() req: AuthenticatedRequest, @Param('code') code: string) {
    this.requireWorkforce(req);
    if (!code || !code.trim()) throw new BadRequestException('code is required');
    return this.service.getProduct(code.trim().toUpperCase());
  }

  /**
   * Maker side (P0-A): PENDING product.modify request (the catalogue has no product.create —
   * registrations are governed by `product.modify` per the approved decisions). Never a direct
   * write.
   */
  @Post('products')
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: ProductCreateBody,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ): Promise<GovernedChangeRequestView> {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'product.modify');
    return this.governance.requestChange({
      principal: req.authorizationPrincipal!,
      action: 'PRODUCT_MODIFY',
      payload: this.buildCreatePayload(body),
      reason: this.requireReason(body),
      expiresInSeconds: this.parseExpiry(expiresInSeconds),
    });
  }

  /** Checker-execution side (P0-A): applies an approved product registration request. */
  @Post('products/changes/:approvalId/execute-create')
  @HttpCode(HttpStatus.CREATED)
  async executeCreate(
    @Req() req: AuthenticatedRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: ProductCreateBody,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'product.modify');
    return this.governance.executeChange({
      principal: req.authorizationPrincipal!,
      action: 'PRODUCT_MODIFY',
      approvalId,
      payload: this.buildCreatePayload(body),
      write: () => this.service.createProduct(this.buildCreateCommand(body), this.actorOf(req)),
    });
  }

  /** Maker side (P0-A): PENDING product.modify request (version-checked at execution). */
  @Patch('products/:code')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('code') code: string,
    @Body() body: ProductUpdateBody,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ): Promise<GovernedChangeRequestView> {
    this.requireWorkforce(req);
    const productId = this.normalizeCode(code);
    return this.governance.requestChange({
      principal: req.authorizationPrincipal!,
      action: 'PRODUCT_MODIFY',
      resourceId: productId,
      payload: this.buildUpdatePayload(body),
      reason: this.requireReason(body),
      expiresInSeconds: this.parseExpiry(expiresInSeconds),
    });
  }

  /** Checker-execution side (P0-A): applies an approved product.modify request. */
  @Post('products/changes/:approvalId/execute-modify')
  @HttpCode(HttpStatus.OK)
  async executeModify(
    @Req() req: AuthenticatedRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: ProductUpdateBody,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'product.modify');
    return this.governance.executeChange({
      principal: req.authorizationPrincipal!,
      action: 'PRODUCT_MODIFY',
      approvalId,
      payload: this.buildUpdatePayload(body),
      write: (resourceId) =>
        this.service.updateProduct(resourceId!, this.buildUpdateCommand(body), this.actorOf(req)),
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

  private actorOf(req: AuthenticatedRequest): string {
    const p = req.authorizationPrincipal as unknown as { principalId?: string; type?: string } | undefined;
    return p?.principalId ?? p?.type ?? 'workforce';
  }

  private clean(v?: string): string | undefined {
    if (v === undefined || v === null) return undefined;
    const t = v.trim();
    return t.length === 0 ? undefined : t.toUpperCase();
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'product_catalog', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }

  private normalizeCode(code: string): string {
    if (!code || !code.trim()) throw new BadRequestException('code is required');
    return code.trim().toUpperCase();
  }

  private buildCreateCommand(body: ProductCreateBody) {
    return {
      code: body.code ?? '',
      name: body.name ?? '',
      description: body.description ?? null,
      domain: body.domain ?? '',
      currency: body.currency,
      productScope: body.productScope,
      status: body.status,
      enabled: body.enabled,
      configurationStatus: body.configurationStatus,
    };
  }

  private buildCreatePayload(body: ProductCreateBody) {
    return { ...this.buildCreateCommand(body), reason: this.requireReason(body) };
  }

  private buildUpdateCommand(body: ProductUpdateBody) {
    if (typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 1) {
      throw new BadRequestException('version is required for updates (optimistic concurrency)');
    }
    return {
      name: body.name,
      description: body.description,
      domain: body.domain,
      status: body.status,
      enabled: body.enabled,
      configurationStatus: body.configurationStatus,
      version: body.version,
    };
  }

  private buildUpdatePayload(body: ProductUpdateBody) {
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
