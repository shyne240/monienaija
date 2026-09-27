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

import { CreateLimitProfileDto } from './dto/create-limit-profile.dto';
import { UpdateLimitProfileDto } from './dto/update-limit-profile.dto';
import { CreateLimitRuleDto } from './dto/create-limit-rule.dto';
import { UpdateLimitRuleDto } from './dto/update-limit-rule.dto';
import { LimitCatalogService } from './limit-catalog.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal')
export class LimitCatalogController {
  constructor(private readonly service: LimitCatalogService) {}

  // ── Profiles ──

  @Post('limit-profiles')
  async createProfile(@Req() req: AuthenticatedRequest, @Body() dto: CreateLimitProfileDto) {
    this.requireWorkforce(req);
    const actor = this.actorOf(req);
    return this.service.createProfile(
      {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        kind: dto.kind,
        status: dto.status,
        enabled: dto.enabled,
        configurationStatus: dto.configurationStatus,
        createdBy: actor,
      },
      actor,
    );
  }

  @Get('limit-profiles')
  async listProfiles(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('enabled') enabled?: string,
    @Query('configurationStatus') configurationStatus?: string,
  ) {
    this.requireWorkforce(req);
    const p = page ? Number.parseInt(page, 10) : undefined;
    const l = limit ? Number.parseInt(limit, 10) : undefined;
    if (page !== undefined && (isNaN(p!) || !Number.isSafeInteger(p!))) throw new BadRequestException('page must be a positive integer');
    if (limit !== undefined && (isNaN(l!) || !Number.isSafeInteger(l!))) throw new BadRequestException('limit must be between 1 and 100');
    let enabledBool: boolean | undefined;
    if (enabled !== undefined && enabled !== '') {
      if (enabled === 'true') enabledBool = true;
      else if (enabled === 'false') enabledBool = false;
      else throw new BadRequestException('enabled must be true or false');
    }
    return this.service.listProfiles({
      kind: this.clean(kind),
      status: this.clean(status),
      enabled: enabledBool,
      configurationStatus: this.clean(configurationStatus),
      page: p,
      limit: l,
    });
  }

  @Get('limit-profiles/:code')
  async getProfile(@Param('code') code: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    if (!code || !/^[A-Z0-9_]{3,80}$/.test(code.trim().toUpperCase())) throw new BadRequestException('code must match ^[A-Z0-9_]{3,80}$');
    return this.service.getProfile(code.trim().toUpperCase());
  }

  @Patch('limit-profiles/:code')
  async updateProfile(@Param('code') code: string, @Req() req: AuthenticatedRequest, @Body() dto: UpdateLimitProfileDto) {
    this.requireWorkforce(req);
    if (!code || !/^[A-Z0-9_]{3,80}$/.test(code.trim().toUpperCase())) throw new BadRequestException('code must match ^[A-Z0-9_]{3,80}$');
    const actor = this.actorOf(req);
    return this.service.updateProfile(code.trim().toUpperCase(), {
      name: dto.name,
      description: dto.description ?? undefined,
      kind: dto.kind,
      status: dto.status,
      enabled: dto.enabled,
      configurationStatus: dto.configurationStatus,
      updatedBy: actor,
      version: dto.version,
    }, actor);
  }

  // ── Rules ──

  @Post('limit-profiles/:code/rules')
  async createRule(@Param('code') code: string, @Req() req: AuthenticatedRequest, @Body() dto: CreateLimitRuleDto) {
    this.requireWorkforce(req);
    if (!code || !/^[A-Z0-9_]{3,80}$/.test(code.trim().toUpperCase())) throw new BadRequestException('code must match ^[A-Z0-9_]{3,80}$');
    const actor = this.actorOf(req);
    return this.service.createRule(
      {
        limitProfileCode: code.trim().toUpperCase(),
        product: dto.product,
        direction: dto.direction ?? null,
        channel: dto.channel ?? null,
        currency: dto.currency,
        dimension: dto.dimension,
        limitValueMinor: dto.limitValueMinor ?? null,
        limitValueCount: dto.limitValueCount ?? null,
        effectiveFrom: dto.effectiveFrom ?? null,
        effectiveTo: dto.effectiveTo ?? null,
        isActive: dto.isActive,
        priority: dto.priority,
        createdBy: actor,
      },
      actor,
    );
  }

  @Get('limit-profiles/:code/rules')
  async listRulesByProfile(
    @Param('code') code: string,
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.requireWorkforce(req);
    if (!code || !/^[A-Z0-9_]{3,80}$/.test(code.trim().toUpperCase())) throw new BadRequestException('code must match ^[A-Z0-9_]{3,80}$');
    const p = page ? Number.parseInt(page, 10) : undefined;
    const l = limit ? Number.parseInt(limit, 10) : undefined;
    if (page !== undefined && (isNaN(p!) || !Number.isSafeInteger(p!))) throw new BadRequestException('page must be a positive integer');
    if (limit !== undefined && (isNaN(l!) || !Number.isSafeInteger(l!))) throw new BadRequestException('limit must be between 1 and 100');
    return this.service.listRulesByProfile(code.trim().toUpperCase(), { page: p, limit: l });
  }

  @Get('limit-rules')
  async listRules(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('limitProfileCode') limitProfileCode?: string,
    @Query('product') product?: string,
    @Query('dimension') dimension?: string,
    @Query('currency') currency?: string,
    @Query('isActive') isActive?: string,
  ) {
    this.requireWorkforce(req);
    const p = page ? Number.parseInt(page, 10) : undefined;
    const l = limit ? Number.parseInt(limit, 10) : undefined;
    if (page !== undefined && (isNaN(p!) || !Number.isSafeInteger(p!))) throw new BadRequestException('page must be a positive integer');
    if (limit !== undefined && (isNaN(l!) || !Number.isSafeInteger(l!))) throw new BadRequestException('limit must be between 1 and 100');
    let isActiveBool: boolean | undefined;
    if (isActive !== undefined && isActive !== '') {
      if (isActive === 'true') isActiveBool = true;
      else if (isActive === 'false') isActiveBool = false;
      else throw new BadRequestException('isActive must be true or false');
    }
    return this.service.listRules({
      limitProfileCode: this.clean(limitProfileCode),
      product: this.clean(product),
      dimension: this.clean(dimension),
      currency: this.clean(currency),
      isActive: isActiveBool,
      page: p,
      limit: l,
    });
  }

  @Get('limit-rules/:id')
  async getRule(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) throw new BadRequestException('id must be UUID');
    return this.service.getRule(id.trim());
  }

  @Patch('limit-rules/:id')
  async updateRule(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Body() dto: UpdateLimitRuleDto) {
    this.requireWorkforce(req);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) throw new BadRequestException('id must be UUID');
    const actor = this.actorOf(req);
    return this.service.updateRule(id.trim(), {
      product: dto.product,
      direction: dto.direction ?? undefined,
      channel: dto.channel === null ? null : dto.channel ?? undefined,
      currency: dto.currency,
      dimension: dto.dimension,
      limitValueMinor: dto.limitValueMinor ?? undefined,
      limitValueCount: dto.limitValueCount ?? undefined,
      effectiveFrom: dto.effectiveFrom ?? undefined,
      effectiveTo: dto.effectiveTo ?? undefined,
      isActive: dto.isActive,
      priority: dto.priority,
      updatedBy: actor,
      version: dto.version,
    }, actor);
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
