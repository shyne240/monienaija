import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';

import { AgentLifecycleService } from './agent-lifecycle.service';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-ADMIN-AUTHORIZATION-HARDENING-01: legacy route alias for AdminAgentLifecycleController.
 * Authorization is now function-based via the `authorization_functions` catalogue
 * (agent.suspend/.terminate/.reactivate/.activate/.review_application), AND-combined with the
 * pre-existing OPERATOR/SERVICE/PRIVILEGED principal-type restriction (SUPPORT/CUSTOMER/AGENT/
 * AGGREGATOR remain denied) — see AuthorizationService.requireFunction and the identical change
 * in AdminAgentLifecycleController.
 */
@Controller('internal/agents')
export class AgentLifecycleController {
  constructor(
    private readonly lifecycleService: AgentLifecycleService,
    private readonly auth: AuthorizationService,
  ) {}

  @Post(':id/activate')
  @HttpCode(200)
  async activate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = await this.requireFunction(req, 'agent.activate');
    // If id is an applicationId, try activateFromApplication; else direct agent activate
    // We support both: if the id looks like an application and application exists, use application activation
    try {
      const app = await this.lifecycleService.activateFromApplication(id, actor);
      return app;
    } catch {
      // fallback to direct agent activation
      return this.lifecycleService.activate(id, actor);
    }
  }

  @Post(':id/suspend')
  @HttpCode(200)
  async suspend(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireFunction(req, 'agent.suspend');
    return this.lifecycleService.suspend(id, actor, body.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = await this.requireFunction(req, 'agent.reactivate');
    return this.lifecycleService.reactivate(id, actor);
  }

  @Post(':id/terminate')
  @HttpCode(200)
  async terminate(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireFunction(req, 'agent.terminate');
    return this.lifecycleService.terminate(id, actor, body.reason);
  }

  @Post('applications/:applicationId/activate')
  @HttpCode(200)
  async activateFromApplication(
    @Param('applicationId') applicationId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireFunction(req, 'agent.review_application');
    return this.lifecycleService.activateFromApplication(applicationId, actor);
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    // deniedStatus: 401 preserves this legacy controller's pre-existing status code for an
    // authenticated-but-insufficiently-privileged principal (it used UnauthorizedException, not
    // ForbiddenException, before this migration — see test/a8-agent-lifecycle.integration.spec.ts).
    return this.auth.requireFunction(
      req.authorizationPrincipal,
      functionCode,
      'agent-lifecycle',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
      { deniedStatus: 401 },
    );
  }
}
