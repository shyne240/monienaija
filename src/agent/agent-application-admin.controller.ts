import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import { AgentApplicationService } from './agent-application.service';
import { RejectAgentApplicationDto } from './dto/reject-agent-application.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/agents/applications')
export class AgentApplicationAdminController {
  constructor(
    private readonly applicationService: AgentApplicationService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    await this.requirePrivileged(req);
    return this.applicationService.list();
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requirePrivileged(req);
    return this.applicationService.getById(id);
  }

  @Post(':id/review')
  @HttpCode(200)
  async review(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = await this.requirePrivileged(req);
    return this.applicationService.markUnderReview(id, actor);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = await this.requirePrivileged(req);
    return this.applicationService.approve(id, actor);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectAgentApplicationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requirePrivileged(req);
    return this.applicationService.reject(id, actor, dto.reason);
  }

  private requirePrivileged(req: AuthenticatedRequest): Promise<string> {
    return this.auth.requireFunction(
      req.authorizationPrincipal,
      'agent.review_application',
      'agent-application',
      ['OPERATOR', 'PRIVILEGED'],
    );
  }
}
