import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import { AgentClassService } from './agent-class.service';
import { CreateAgentClassDto } from './dto/create-agent-class.dto';
import { UpdateAgentClassDto } from './dto/update-agent-class.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/agents/classes')
export class AgentClassController {
  constructor(
    private readonly classService: AgentClassService,
    private readonly auth: AuthorizationService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateAgentClassDto, @Req() req: AuthenticatedRequest) {
    const actor = await this.requirePrivilegedActor(req);
    return this.classService.create({
      reference: dto.reference,
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
      isActive: dto.isActive,
      requirements: dto.requirements ?? null,
      requiredInformation: dto.requiredInformation ?? null,
      requiredDocumentCategories: dto.requiredDocumentCategories ?? null,
      applicableServices: dto.applicableServices ?? null,
      applicableLimits: dto.applicableLimits ?? null,
      actor,
    });
  }

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    await this.requirePrivilegedActor(req, 'agent.view');
    return this.classService.list();
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requirePrivilegedActor(req, 'agent.view');
    return this.classService.getById(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAgentClassDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requirePrivilegedActor(req);
    return this.classService.update(id, {
      name: dto.name,
      description: dto.description,
      isActive: dto.isActive,
      requirements: dto.requirements,
      requiredInformation: dto.requiredInformation,
      requiredDocumentCategories: dto.requiredDocumentCategories,
      applicableServices: dto.applicableServices,
      applicableLimits: dto.applicableLimits,
      actor,
      expectedVersion: dto.expectedVersion,
    });
  }

  private requirePrivilegedActor(
    req: AuthenticatedRequest,
    functionCode = 'agent.manage_classes',
  ): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'agent-class', [
      'OPERATOR',
      'PRIVILEGED',
    ]);
  }
}
