import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import { AgentApplicationService } from './agent-application.service';
import { CreateAgentApplicationDto } from './dto/create-agent-application.dto';
import { UpdateAgentApplicationDto } from './dto/update-agent-application.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
  params?: Record<string, string | undefined>;
}

@Controller('agents/applications')
export class AgentApplicationPublicController {
  constructor(
    private readonly applicationService: AgentApplicationService,
    private readonly auth: AuthorizationService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateAgentApplicationDto, @Req() req: RequestLike) {
    // V1 onboarding is workforce-led; the authenticated principal supplies the audit actor.
    const actor = await this.requireAccess(req);
    return this.applicationService.create({
      agentClassId: dto.agentClassId,
      agentClassReference: dto.agentClassReference,
      applicantReference: dto.applicantReference ?? dto.businessName ?? actor,
      businessName: dto.businessName ?? null,
      contactEmail: dto.contactEmail ?? null,
      payload: dto.payload ?? null,
      actor,
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: RequestLike) {
    await this.requireAccess(req);
    return this.applicationService.getById(id);
  }

  @Patch(':id')
  async updateDraft(
    @Param('id') id: string,
    @Body() dto: UpdateAgentApplicationDto,
    @Req() req: RequestLike,
  ) {
    const actor = await this.requireAccess(req);
    return this.applicationService.updateDraft(id, {
      businessName: dto.businessName,
      contactEmail: dto.contactEmail,
      payload: dto.payload,
      agentClassId: dto.agentClassId,
      actor,
      expectedVersion: dto.expectedVersion,
    });
  }

  @Post(':id/submit')
  @HttpCode(200)
  async submit(@Param('id') id: string, @Req() req: RequestLike) {
    const actor = await this.requireAccess(req);
    return this.applicationService.submit(id, actor);
  }

  private requireAccess(req: RequestLike): Promise<string> {
    return this.auth.requireFunction(
      req.authorizationPrincipal,
      'agent.review_application',
      'agent-application',
      ['OPERATOR', 'PRIVILEGED'],
    );
  }
}
