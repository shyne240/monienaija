import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  AssignCustomerClassDto,
  CreateCustomerClassDto,
  UpdateCustomerClassDto,
} from './dto/customer-class.dto';
import { CustomerClassAssignmentService } from './customer-class-assignment.service';
import { CustomerClassService } from './customer-class.service';
import { CustomerClassResolverService } from './customer-class-resolver.service';
import { CustomerClassAssignmentSource } from './customer-class.enums';
import type { EffectiveCustomerClass } from './customer-class.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/** Wire shape for a resolved class, per the coordination §4 "Customer class" contract. */
function effectiveView(effective: EffectiveCustomerClass | null) {
  if (!effective) return null;
  return {
    classCode: effective.classCode,
    assignmentId: effective.assignmentId,
    classId: effective.classId,
    className: effective.className,
    effectiveFrom: effective.effectiveFrom,
    effectiveTo: effective.effectiveTo,
    version: effective.assignmentVersion,
    classVersion: effective.classVersion,
    source: effective.source,
  };
}

/**
 * ARENA 1 — customer classes of service. Read surface uses `customer.view`; catalogue and
 * assignment mutations use the dedicated `customer.manage_classes` function (mirrors
 * `agent.manage_classes`). Backend guards are authoritative.
 */
@Controller('internal/customer-classes')
export class CustomerClassController {
  constructor(
    private readonly classes: CustomerClassService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateCustomerClassDto, @Req() req: AuthenticatedRequest) {
    const actor = await this.requireFunction(req, 'customer.manage_classes');
    return this.classes.create({
      reference: dto.reference,
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
      status: dto.status,
      enabled: dto.enabled,
      configurationStatus: dto.configurationStatus,
      isDefault: dto.isDefault,
      actor,
    });
  }

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'customer.view');
    return this.classes.list();
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'customer.view');
    return this.classes.getById(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerClassDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireFunction(req, 'customer.manage_classes');
    return this.classes.update(id, {
      name: dto.name,
      description: dto.description,
      status: dto.status,
      enabled: dto.enabled,
      configurationStatus: dto.configurationStatus,
      isDefault: dto.isDefault,
      expectedVersion: dto.expectedVersion,
      actor,
    });
  }

  private async requireFunction(
    req: AuthenticatedRequest,
    functionCode: 'customer.view' | 'customer.manage_classes',
  ): Promise<string> {
    return this.authorizationService.requireFunction(
      req.authorizationPrincipal,
      functionCode,
      'customer-class',
      functionCode === 'customer.view'
        ? ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']
        : ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
  }
}

@Controller('internal/customers')
export class CustomerClassAssignmentController {
  constructor(
    private readonly assignments: CustomerClassAssignmentService,
    private readonly resolver: CustomerClassResolverService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  /** The coordination §4 contract: flat `{ classCode, assignmentId, effectiveFrom, version }` or null. */
  @Get(':id/class')
  async effective(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.authorizationService.requireFunction(
      req.authorizationPrincipal,
      'customer.view',
      'customer-class',
      ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    const effective = await this.resolver.resolveOuter(id);
    return effectiveView(effective);
  }

  /** Auditable assignment history (closed + live rows), most recent first. */
  @Get(':id/class/history')
  async history(
    @Param('id') id: string,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.authorizationService.requireFunction(
      req.authorizationPrincipal,
      'customer.view',
      'customer-class',
      ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    const parsed = limit === undefined ? 25 : Number.parseInt(limit, 10);
    return this.assignments.history(id, Number.isFinite(parsed) && parsed > 0 ? parsed : 25);
  }

  /** Switch a customer's class. Re-assigning the live class is an idempotent no-op. */
  @Post(':id/class')
  @HttpCode(200)
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignCustomerClassDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.authorizationService.requireFunction(
      req.authorizationPrincipal,
      'customer.manage_classes',
      'customer-class-assignment',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    if (
      dto.expectedVersion !== undefined &&
      dto.expected_version !== undefined &&
      dto.expectedVersion !== dto.expected_version
    ) {
      throw new BadRequestException('Conflicting assignment versions');
    }
    if (dto.effectiveFrom && dto.effective_from && dto.effectiveFrom !== dto.effective_from) {
      throw new BadRequestException('Conflicting effective timestamps');
    }
    const timestamp = dto.effectiveFrom ?? dto.effective_from;
    const result = await this.assignments.assignOuter({
      customerId: id,
      classCode: dto.classCode,
      reason: dto.reason,
      source: CustomerClassAssignmentSource.SWITCH,
      actor,
      effectiveFrom: timestamp ? new Date(timestamp) : undefined,
      expectedAssignmentVersion: dto.expectedVersion ?? dto.expected_version,
    });
    return {
      ...effectiveView(result.assignment),
      previousClassCode: result.previousClassCode,
      replayed: result.replayed,
    };
  }
}
