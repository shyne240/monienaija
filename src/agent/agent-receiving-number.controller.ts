import { Controller, Get, Param, Req } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentReceivingNumberService } from './agent-receiving-number.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * Agent-facing receiving-number alias.
 *
 * V1-SPRINT2-AUTHZ-01 (ARENA 3): authorization is enforced by RuntimeAccessGuard through
 * RoutePolicyRegistry — the generic /api/v1/agents/* branch binds agentAccess 'SELF' to the
 * *requested* :id (extracted from route params), so a session Agent may only read its own
 * receiving number and any cross-Agent id is denied 403 without existence disclosure
 * (docs/V1/A21-AGENT-APP-CONTRACT.md:42-43). Non-AGENT principals are denied by the same
 * policy. The SELF-derived alias GET /agents/me/receiving-number (agent-app.controller)
 * remains the preferred client route.
 */
@Controller('agents')
export class AgentReceivingNumberController {
  constructor(private readonly receivingService: AgentReceivingNumberService) {}

  @Get(':id/receiving-number')
  async get(@Param('id') id: string) {
    const view = await this.receivingService.getByAgentId(id);
    if (!view) {
      return { agentId: id, receivingNumber: null, status: 'NONE' };
    }
    return view;
  }
}

/**
 * Workforce-facing internal receiving-number read.
 *
 * V1-SPRINT2-AUTHZ-01 (ARENA 3): previously this controller performed NO authorization and
 * the guard's WORKFORCE_SESSION branch admits any authenticated workforce principal
 * (including SUPPORT) without consulting route.policy — so every workforce role could read
 * every Agent's receiving number. Policy:
 * docs/V1/V1-PHASE1-AGENT-SECURITY-IMPLEMENTATION-01.md §"Applications and function
 * permissions" — "Internal receiving-number reads require agent.view." Enforced here with
 * the established AuthorizationService.requireFunction() pattern (same as
 * AgentClassController); SUPPORT holds no agent-domain functions by policy and the
 * allowed-principal-type list excludes it explicitly. The matching RoutePolicyRegistry
 * branch declares the same gate for defense in depth.
 */
@Controller('internal/agents')
export class AgentReceivingNumberInternalController {
  constructor(
    private readonly receivingService: AgentReceivingNumberService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Get(':id/receiving-number')
  async getInternal(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.authorizationService.requireFunction(
      req.authorizationPrincipal,
      'agent.view',
      'agent-receiving-number',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    const view = await this.receivingService.getByAgentId(id);
    if (!view) {
      return { agentId: id, receivingNumber: null, status: 'NONE' };
    }
    return view;
  }
}
