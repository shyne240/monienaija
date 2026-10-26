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

import { CreateProductGovernanceDto } from './dto/create-product-governance.dto';
import { ProductGovernanceQueryDto } from './dto/product-governance-query.dto';
import { ProductGovernanceKind } from './product-governance.enums';
import { UpdateProductGovernanceDto } from './dto/update-product-governance.dto';
import { ProductGovernanceService } from './product-governance.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/product-governance')
export class ProductGovernanceController {
  constructor(
    private readonly service: ProductGovernanceService,
    private readonly governance: CommercialRuleGovernanceService,
    private readonly auth: AuthorizationService,
  ) {}

  /** Maker side (P0-A): PENDING product.governance request — never a direct write. */
  @Post('records')
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateProductGovernanceDto,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ): Promise<GovernedChangeRequestView> {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'product.governance');
    return this.governance.requestChange({
      principal: req.authorizationPrincipal!,
      action: 'PRODUCT_GOVERNANCE',
      payload: this.buildCreatePayload(dto),
      reason: this.requireReason(dto.reason),
      expiresInSeconds: this.parseExpiry(expiresInSeconds),
    });
  }

  /** Checker-execution side (P0-A): applies an approved product.governance create request. */
  @Post('changes/:approvalId/execute-create')
  @HttpCode(HttpStatus.CREATED)
  async executeCreate(
    @Req() req: AuthenticatedRequest,
    @Param('approvalId') approvalId: string,
    @Body() dto: CreateProductGovernanceDto,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'product.governance');
    return this.governance.executeChange({
      principal: req.authorizationPrincipal!,
      action: 'PRODUCT_GOVERNANCE',
      approvalId,
      payload: this.buildCreatePayload(dto),
      write: () => this.service.create(this.buildCreateCommand(dto)),
    });
  }

  @Get('records')
  list(@Query() query: ProductGovernanceQueryDto) {
    return this.service.list(query.kind, query.status, query.limit);
  }

  @Get('records/:id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  /** Maker side (P0-A): PENDING product.governance update request. */
  @Patch('records/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateProductGovernanceDto,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ): Promise<GovernedChangeRequestView> {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'product.governance');
    return this.governance.requestChange({
      principal: req.authorizationPrincipal!,
      action: 'PRODUCT_GOVERNANCE',
      resourceId: id,
      payload: this.buildUpdatePayload(dto),
      reason: this.requireReason(dto.reason),
      expiresInSeconds: this.parseExpiry(expiresInSeconds),
    });
  }

  /** Checker-execution side (P0-A): applies an approved product.governance update request. */
  @Post('changes/:approvalId/execute-modify')
  @HttpCode(HttpStatus.OK)
  async executeModify(
    @Req() req: AuthenticatedRequest,
    @Param('approvalId') approvalId: string,
    @Body() dto: UpdateProductGovernanceDto,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'product.governance');
    return this.governance.executeChange({
      principal: req.authorizationPrincipal!,
      action: 'PRODUCT_GOVERNANCE',
      approvalId,
      payload: this.buildUpdatePayload(dto),
      write: (resourceId) => this.service.update(resourceId!, this.buildUpdateCommand(dto)),
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
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'product_governance', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }

  private buildCreateCommand(dto: CreateProductGovernanceDto) {
    return {
      kind: dto.kind,
      recordKey: dto.recordKey,
      name: dto.name,
      status: dto.status,
      version: dto.version,
      parentId: dto.parentId,
      payload: dto.payload,
      immutableRecord: dto.immutableRecord,
      actor: dto.actor,
    };
  }

  private buildCreatePayload(dto: CreateProductGovernanceDto) {
    return { ...this.buildCreateCommand(dto), reason: this.requireReason(dto.reason) };
  }

  private buildUpdateCommand(dto: UpdateProductGovernanceDto) {
    return {
      name: dto.name,
      status: dto.status,
      payload: dto.payload,
      actor: dto.actor,
    };
  }

  private buildUpdatePayload(dto: UpdateProductGovernanceDto) {
    return { ...this.buildUpdateCommand(dto), reason: this.requireReason(dto.reason) };
  }

  private requireReason(reason: string): string {
    const normalized = typeof reason === 'string' ? reason.trim() : '';
    if (!normalized || normalized.length > 500) {
      throw new BadRequestException('reason must contain 1 to 500 characters');
    }
    return normalized;
  }

  private parseExpiry(raw?: string): number | undefined {
    if (raw === undefined || raw === '') return undefined;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 60 || parsed > 86_400) {
      throw new BadRequestException('expiresInSeconds must be an integer between 60 and 86400');
    }
    return parsed;
  }

  @Get('report')
  report() {
    return this.service.report();
  }

  @Get('readiness')
  readiness() {
    return this.service.launchReadiness();
  }

  @Get('configuration')
  configuration(@Query() query: ProductGovernanceQueryDto) {
    return this.service.list(
      ProductGovernanceKind.PRODUCT_CONFIGURATION,
      query.status,
      query.limit,
    );
  }
}
