import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentClassTransitionService } from './agent-class-transition.service';
import { SwitchAgentClassDto } from './dto/switch-agent-class.dto';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const READ_PRINCIPALS = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'] as const;
const WRITE_PRINCIPALS = ['OPERATOR', 'SERVICE', 'PRIVILEGED'] as const;

/**
 * V1-AGENT-CLASS-LIFECYCLE-01 — the agent-side counterpart of the customer class surface.
 *
 * Route shape mirrors `internal/customers/:id/class{,/history}` so operators learn one vocabulary.
 * Reads need `agent.view` (SUPPORT included — reading why an Agent is blocked is an investigation,
 * not a mutation); the switch needs `agent.manage_classes` AND a non-read-only principal, because a
 * class switch widens or narrows what an Agent may transact.
 *
 * Mounted BEFORE the generic `internal/agents/:id` detail route in the module's controller order and
 * given its own route-policy branch: `/api/v1/internal/agents/<uuid>/<word>` must never be resolved
 * by the catch-all `/internal/` fallback, which carries no catalogue function.
 */
@Controller('internal/agents')
export class AgentClassTransitionController {
  constructor(
    private readonly transitions: AgentClassTransitionService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Get(':id/class/readiness')
  async readiness(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireRead(req);
    return this.transitions.readiness(id);
  }

  @Get(':id/class/history')
  async history(
    @Param('id') id: string,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.requireRead(req);
    const parsed = limit === undefined ? 25 : Number.parseInt(limit, 10);
    return this.transitions.history(id, Number.isFinite(parsed) && parsed > 0 ? parsed : 25);
  }

  /** Read-only: returns the service delta for a hypothetical switch and writes nothing. */
  @Get(':id/class/impact-preview')
  async impactPreview(
    @Param('id') id: string,
    @Query('targetClassId') targetClassId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.requireRead(req);
    return this.transitions.impactPreview(id, targetClassId ?? '');
  }

  @Get(':id/class')
  async current(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireRead(req);
    const readiness = await this.transitions.readiness(id);
    return {
      agentId: readiness.agentId,
      agentClassId: readiness.currentClassId,
      currentClass: readiness.currentClass,
      approvedDefault: readiness.approvedDefault,
      approvedDefaultBasis: readiness.approvedDefaultBasis,
    };
  }

  @Post(':id/class')
  @HttpCode(200)
  async switchClass(
    @Param('id') id: string,
    @Body() dto: SwitchAgentClassDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = await this.authorizationService.requireFunction(
      req.authorizationPrincipal,
      'agent.manage_classes',
      'agent-class-transition',
      WRITE_PRINCIPALS,
    );
    if (req.authorizationPrincipal?.readOnlyPrincipal) {
      throw new ForbiddenException('Read-only principal cannot reclassify an Agent');
    }
    return this.transitions.switchClass({
      agentId: id,
      targetClassId: dto.targetClassId,
      reason: dto.reason,
      actor,
      expectedVersion: dto.expectedVersion,
    });
  }

  private async requireRead(req: AuthenticatedRequest) {
    await this.authorizationService.requireFunction(
      req.authorizationPrincipal,
      'agent.view',
      'agent-class-transition',
      READ_PRINCIPALS,
    );
  }
}
