import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';

import { AgentLifecycleService } from '../agent/agent-lifecycle.service';
import { AuthorizationService } from '../authorization/authorization.service';
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
 *
 * V1-ADMIN-AUTHORIZATION-HARDENING-01: authorization is now function-based via the
 * `authorization_functions` catalogue (agent.suspend/.terminate/.reactivate/.activate/
 * .review_application), not a bare principal-type check. `allowedPrincipalTypes:
 * ['OPERATOR','SERVICE','PRIVILEGED']` is retained and AND-combined with the function
 * requirement (see AuthorizationService.requireFunction) so SUPPORT/CUSTOMER/AGENT/AGGREGATOR
 * remain denied exactly as before, and OPERATOR-type principals that lack the specific
 * catalogue function (e.g. FINANCE_AUDITOR, FINANCE_PREPARER, FINANCE_CONTROLLER, COMPLIANCE,
 * RISK_FRAUD, CUSTOMER_SERVICE, TREASURY — none of which hold any agent.* EXECUTE function) are
 * now denied where they previously succeeded purely by virtue of their principal type collapsing
 * to OPERATOR.
 */
@Controller('internal/admin/agents')
export class AdminAgentLifecycleController {
  constructor(
    private readonly lifecycleService: AgentLifecycleService,
    private readonly auth: AuthorizationService,
  ) {}

  @Post(':id/suspend')
  @HttpCode(200)
  async suspend(
    @Param('id') id: string,
    @Body() body: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireFunction(req, 'agent.suspend');
    return this.sanitize(await this.lifecycleService.suspend(id, actor, body?.reason));
  }

  @Post(':id/terminate')
  @HttpCode(200)
  async terminate(
    @Param('id') id: string,
    @Body() body: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.requireFunction(req, 'agent.terminate');
    return this.sanitize(await this.lifecycleService.terminate(id, actor, body?.reason));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = await this.requireFunction(req, 'agent.reactivate');
    return this.sanitize(await this.lifecycleService.reactivate(id, actor));
  }

  @Post(':id/activate')
  @HttpCode(200)
  async activate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = await this.requireFunction(req, 'agent.activate');
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
    const actor = await this.requireFunction(req, 'agent.review_application');
    return this.sanitize(await this.lifecycleService.activateFromApplication(applicationId, actor));
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'admin-agent-lifecycle', [
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }

  private sanitize(agent: any): any {
    // Safe projection — reuse Agent entity fields only (no credentials, no secrets)
    if (!agent) return agent;
    const { id, reference, status, agentClassId, originApplicationId, version, createdAt, updatedAt, deletedAt } = agent as any;
    return { id, reference, status, agentClassId, originApplicationId, version, createdAt, updatedAt, deletedAt };
  }
}
