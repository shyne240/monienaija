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

import { CreateLimitAssignmentDto } from './dto/create-limit-assignment.dto';
import { UpdateLimitAssignmentDto } from './dto/update-limit-assignment.dto';
import { LimitAssignmentService } from './limit-assignment.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal')
export class LimitAssignmentController {
  constructor(private readonly service: LimitAssignmentService) {}

  @Post('limit-assignments')
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateLimitAssignmentDto) {
    this.requireWorkforce(req);
    const actor = this.actorOf(req);
    return this.service.createAssignment(
      {
        limitProfileCode: dto.limitProfileCode,
        subjectType: dto.subjectType,
        subjectId: dto.subjectId ?? null,
        segmentCode: dto.segmentCode ?? null,
        precedence: dto.precedence,
        effectiveFrom: dto.effectiveFrom ?? null,
        effectiveTo: dto.effectiveTo ?? null,
        isActive: dto.isActive,
        createdBy: actor,
      },
      actor,
    );
  }

  @Get('limit-assignments')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
    @Query('segmentCode') segmentCode?: string,
    @Query('limitProfileCode') limitProfileCode?: string,
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
    return this.service.listAssignments({
      subjectType: this.clean(subjectType),
      subjectId: subjectId ? subjectId.trim() : undefined,
      segmentCode: this.clean(segmentCode),
      limitProfileCode: this.clean(limitProfileCode),
      isActive: isActiveBool,
      page: p,
      limit: l,
    });
  }

  @Get('limit-assignments/profile/:code')
  async listByProfile(@Param('code') code: string, @Req() req: AuthenticatedRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    this.requireWorkforce(req);
    if (!code || !/^[A-Z0-9_]{3,80}$/.test(code.trim().toUpperCase())) throw new BadRequestException('code must match ^[A-Z0-9_]{3,80}$');
    const p = page ? Number.parseInt(page, 10) : undefined;
    const l = limit ? Number.parseInt(limit, 10) : undefined;
    if (page !== undefined && (isNaN(p!) || !Number.isSafeInteger(p!))) throw new BadRequestException('page must be a positive integer');
    if (limit !== undefined && (isNaN(l!) || !Number.isSafeInteger(l!))) throw new BadRequestException('limit must be between 1 and 100');
    return this.service.listByProfile(code.trim().toUpperCase(), { page: p, limit: l });
  }

  @Get('limit-assignments/customer/:id')
  async listByCustomer(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    this.requireWorkforce(req);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) throw new BadRequestException('id must be UUID');
    const p = page ? Number.parseInt(page, 10) : undefined;
    const l = limit ? Number.parseInt(limit, 10) : undefined;
    if (page !== undefined && (isNaN(p!) || !Number.isSafeInteger(p!))) throw new BadRequestException('page must be a positive integer');
    if (limit !== undefined && (isNaN(l!) || !Number.isSafeInteger(l!))) throw new BadRequestException('limit must be between 1 and 100');
    return this.service.listByCustomer(id.trim(), { page: p, limit: l });
  }

  @Get('limit-assignments/agent/:id')
  async listByAgent(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    this.requireWorkforce(req);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) throw new BadRequestException('id must be UUID');
    const p = page ? Number.parseInt(page, 10) : undefined;
    const l = limit ? Number.parseInt(limit, 10) : undefined;
    if (page !== undefined && (isNaN(p!) || !Number.isSafeInteger(p!))) throw new BadRequestException('page must be a positive integer');
    if (limit !== undefined && (isNaN(l!) || !Number.isSafeInteger(l!))) throw new BadRequestException('limit must be between 1 and 100');
    return this.service.listByAgent(id.trim(), { page: p, limit: l });
  }

  @Get('limit-assignments/agent-class/:id')
  async listByAgentClass(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    this.requireWorkforce(req);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) throw new BadRequestException('id must be UUID');
    const p = page ? Number.parseInt(page, 10) : undefined;
    const l = limit ? Number.parseInt(limit, 10) : undefined;
    if (page !== undefined && (isNaN(p!) || !Number.isSafeInteger(p!))) throw new BadRequestException('page must be a positive integer');
    if (limit !== undefined && (isNaN(l!) || !Number.isSafeInteger(l!))) throw new BadRequestException('limit must be between 1 and 100');
    return this.service.listByAgentClass(id.trim(), { page: p, limit: l });
  }

  @Get('limit-assignments/segment/:code')
  async listBySegment(@Param('code') code: string, @Req() req: AuthenticatedRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    this.requireWorkforce(req);
    if (!code || !/^[A-Z0-9_]{3,80}$/.test(code.trim().toUpperCase())) throw new BadRequestException('code must match ^[A-Z0-9_]{3,80}$');
    const p = page ? Number.parseInt(page, 10) : undefined;
    const l = limit ? Number.parseInt(limit, 10) : undefined;
    if (page !== undefined && (isNaN(p!) || !Number.isSafeInteger(p!))) throw new BadRequestException('page must be a positive integer');
    if (limit !== undefined && (isNaN(l!) || !Number.isSafeInteger(l!))) throw new BadRequestException('limit must be between 1 and 100');
    return this.service.listAssignments({ subjectType: 'SEGMENT', segmentCode: code.trim().toUpperCase(), page: p, limit: l });
  }

  @Get('limit-assignments/:id')
  async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) throw new BadRequestException('id must be UUID');
    return this.service.getAssignment(id.trim());
  }

  @Patch('limit-assignments/:id')
  async update(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Body() dto: UpdateLimitAssignmentDto) {
    this.requireWorkforce(req);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) throw new BadRequestException('id must be UUID');
    const actor = this.actorOf(req);
    return this.service.updateAssignment(id.trim(), {
      limitProfileCode: dto.limitProfileCode,
      subjectType: dto.subjectType,
      subjectId: dto.subjectId ?? undefined,
      segmentCode: dto.segmentCode ?? undefined,
      precedence: dto.precedence,
      effectiveFrom: dto.effectiveFrom ?? undefined,
      effectiveTo: dto.effectiveTo ?? undefined,
      isActive: dto.isActive,
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
