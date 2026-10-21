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

import { ProductCatalogService } from './product-catalog.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
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
  constructor(private readonly service: ProductCatalogService) {}

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

  @Post('products')
  async create(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      code?: string;
      name?: string;
      description?: string | null;
      domain?: string;
      currency?: string;
      productScope?: string;
      status?: string;
      enabled?: boolean;
      configurationStatus?: string;
    },
  ) {
    this.requireWorkforce(req);
    return this.service.createProduct(
      {
        code: body.code ?? '',
        name: body.name ?? '',
        description: body.description ?? null,
        domain: body.domain ?? '',
        currency: body.currency,
        productScope: body.productScope,
        status: body.status,
        enabled: body.enabled,
        configurationStatus: body.configurationStatus,
      },
      this.actorOf(req),
    );
  }

  @Patch('products/:code')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('code') code: string,
    @Body()
    body: {
      name?: string;
      description?: string | null;
      domain?: string;
      status?: string;
      enabled?: boolean;
      configurationStatus?: string;
      version?: number;
    },
  ) {
    this.requireWorkforce(req);
    if (!code || !code.trim()) throw new BadRequestException('code is required');
    if (typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 1) {
      throw new BadRequestException('version is required for updates (optimistic concurrency)');
    }
    return this.service.updateProduct(
      code.trim().toUpperCase(),
      {
        name: body.name,
        description: body.description,
        domain: body.domain,
        status: body.status,
        enabled: body.enabled,
        configurationStatus: body.configurationStatus,
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
