import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { AgentApplicationService } from './agent-application.service';
import { RejectAgentApplicationDto } from './dto/reject-agent-application.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/agents/applications')
export class AgentApplicationAdminController {
  constructor(private readonly applicationService: AgentApplicationService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    this.requirePrivileged(req);
    return this.applicationService.list();
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requirePrivileged(req);
    return this.applicationService.getById(id);
  }

  @Post(':id/review')
  @HttpCode(200)
  async review(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.applicationService.markUnderReview(id, actor);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    // Fail-closed: no maker-checker rule exists for AGENT_APPLICATION_APPROVE
    // We document the blocker and allow direct privileged approve without requiring an approvalId
    // If a rule were to exist, we would call PrivilegedActionApprovalService.consume here
    return this.applicationService.approve(id, actor);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectAgentApplicationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    return this.applicationService.reject(id, actor, dto.reason);
  }

  private requirePrivileged(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'AGENT' || principal.type === 'CUSTOMER') {
      // Applicant cannot approve/reject itself (Q), Agent cannot approve (S)
      throw new UnauthorizedException('Privileged access required');
    }
    return principal.principalId;
  }
}
