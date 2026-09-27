import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';

import { CapabilityService } from './capability.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/capabilities')
export class CapabilityController {
  constructor(private readonly service: CapabilityService) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('domain') domain?: string,
    @Query('lifecycle') lifecycle?: string,
    @Query('backendStatus') backendStatus?: string,
    @Query('apiStatus') apiStatus?: string,
    @Query('adminUiStatus') adminUiStatus?: string,
    @Query('customerUiStatus') customerUiStatus?: string,
    @Query('agentUiStatus') agentUiStatus?: string,
    @Query('enabled') enabled?: string,
    @Query('productScope') productScope?: string,
    @Query('blockerType') blockerType?: string,
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
    return this.service.list({
      domain: this.clean(domain),
      lifecycle: this.clean(lifecycle),
      backendStatus: this.clean(backendStatus),
      apiStatus: this.clean(apiStatus),
      adminUiStatus: this.clean(adminUiStatus),
      customerUiStatus: this.clean(customerUiStatus),
      agentUiStatus: this.clean(agentUiStatus),
      enabled: enabledBool,
      productScope: this.clean(productScope),
      blockerType: this.clean(blockerType),
      page: p,
      limit: l,
    });
  }

  @Get('summary')
  async summary(@Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    return this.service.summary();
  }

  @Get(':code')
  async getOne(@Param('code') code: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    if (!code || !/^[A-Z0-9_]{3,80}$/.test(code.trim())) throw new BadRequestException('capabilityCode must be 3-80 chars A-Z0-9_');
    try {
      return await this.service.findByCode(code.trim());
    } catch (e) {
      if ((e as Error).message?.includes('not found')) throw new NotFoundException((e as Error).message);
      throw e;
    }
  }

  private requireWorkforce(req: AuthenticatedRequest): void {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'AGENT' || principal.type === 'CUSTOMER' || (principal.type as string) === 'AGGREGATOR') {
      throw new UnauthorizedException('Privileged access required');
    }
  }

  private clean(v?: string): string | undefined {
    if (v === undefined || v === null) return undefined;
    const t = v.trim();
    return t.length === 0 ? undefined : t.toUpperCase();
  }
}
