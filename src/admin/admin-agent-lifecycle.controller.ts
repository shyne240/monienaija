import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

import { AgentLifecycleService } from '../agent/agent-lifecycle.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

class ReasonDto {
  reason?: string;
}

/**
 * V1-003 Admin Operational Control Plane — Agent lifecycle.
 * Wraps authoritative AgentLifecycleService (no second engine).
 * Route aliases under /internal/admin/agents/* plus legacy /internal/agents/* remain via AgentLifecycleController.
 * Authorization: OPERATOR, SERVICE, PRIVILEGED only (SUPPORT denied, CUSTOMER/AGENT denied) — documented decision.
 */
@Controller('internal/admin/agents')
export class AdminAgentLifecycleController {
  constructor(private readonly lifecycleService: AgentLifecycleService) {}

  @Post(':id/suspend')
  @HttpCode(200)
  async suspend(
    @Param('id') id: string,
    @Body() body: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requireOperational(req);
    return this.sanitize(await this.lifecycleService.suspend(id, actor, body?.reason));
  }

  @Post(':id/terminate')
  @HttpCode(200)
  async terminate(
    @Param('id') id: string,
    @Body() body: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requireOperational(req);
    return this.sanitize(await this.lifecycleService.terminate(id, actor, body?.reason));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requireOperational(req);
    return this.sanitize(await this.lifecycleService.reactivate(id, actor));
  }

  @Post(':id/activate')
  @HttpCode(200)
  async activate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requireOperational(req);
    try {
      const viaApplication = await this.lifecycleService.activateFromApplication(id, actor);
      return this.sanitize(viaApplication);
    } catch {
      return this.sanitize(await this.lifecycleService.activate(id, actor));
    }
  }

  @Post('applications/:applicationId/activate')
  @HttpCode(200)
  async activateFromApplication(
    @Param('applicationId') applicationId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requireOperational(req);
    return this.sanitize(await this.lifecycleService.activateFromApplication(applicationId, actor));
  }

  private requireOperational(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    // V1-003 decision: SUPPORT may not perform lifecycle control (OPERATOR/SERVICE/PRIVILEGED only)
    // Keep CUSTOMER/AGENT/AGGREGATOR denied via generic guard, but also deny SUPPORT here
    if (
      principal.type === 'CUSTOMER' ||
      principal.type === 'AGENT' ||
      (principal.type as string) === 'AGGREGATOR' ||
      principal.type === 'SUPPORT'
    ) {
      // Use 403 for authenticated but insufficient privilege to distinguish from 401 unauth
      throw new ForbiddenException('Operational access required');
    }
    if (!['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type as string)) {
      throw new ForbiddenException('Operational access required');
    }
    return principal.principalId;
  }

  private sanitize(agent: any): any {
    // Safe projection — reuse Agent entity fields only (no credentials, no secrets)
    if (!agent) return agent;
    const { id, reference, status, agentClassId, originApplicationId, version, createdAt, updatedAt, deletedAt } = agent as any;
    return { id, reference, status, agentClassId, originApplicationId, version, createdAt, updatedAt, deletedAt };
  }
}
