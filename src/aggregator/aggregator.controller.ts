import { Body, Controller, Get, HttpCode, Param, Post, Req, UnauthorizedException } from '@nestjs/common';

import { AggregatorService } from './aggregator.service';
import { AggregatorAgentRelationshipService } from './aggregator-agent-relationship.service';
import { CreateAggregatorDto } from './dto/create-aggregator.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/aggregators')
export class AggregatorController {
  constructor(
    private readonly aggregatorService: AggregatorService,
    private readonly relationshipService: AggregatorAgentRelationshipService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateAggregatorDto, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.aggregatorService.create({
      reference: dto.reference,
      code: dto.code,
      corporateName: dto.corporateName,
      displayName: dto.displayName,
      contactEmail: dto.contactEmail,
      contactPhone: dto.contactPhone,
      actor,
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requirePrivileged(req);
    return this.aggregatorService.getById(id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  async activate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.aggregatorService.activate(id, actor);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  async suspend(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.aggregatorService.suspend(id, actor, body.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.aggregatorService.reactivate(id, actor);
  }

  @Post(':id/terminate')
  @HttpCode(200)
  async terminate(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.aggregatorService.terminate(id, actor, body.reason);
  }

  @Post(':aggregatorId/agents')
  @HttpCode(201)
  async assignAgent(
    @Param('aggregatorId') aggregatorId: string,
    @Body() body: { agentId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    return this.relationshipService.assign({ aggregatorId, agentId: body.agentId, actor });
  }

  @Get(':aggregatorId/agents')
  async listAgents(@Param('aggregatorId') aggregatorId: string, @Req() req: AuthenticatedRequest) {
    this.requirePrivileged(req);
    return this.relationshipService.listForAggregator(aggregatorId);
  }

  @Post(':aggregatorId/agents/:agentId/suspend')
  @HttpCode(200)
  async suspendAssignment(
    @Param('aggregatorId') aggregatorId: string,
    @Param('agentId') agentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    return this.relationshipService.suspend({ aggregatorId, agentId, actor });
  }

  @Post(':aggregatorId/agents/:agentId/reactivate')
  @HttpCode(200)
  async reactivateAssignment(
    @Param('aggregatorId') aggregatorId: string,
    @Param('agentId') agentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    return this.relationshipService.reactivate({ aggregatorId, agentId, actor });
  }

  @Post(':aggregatorId/agents/:agentId/terminate')
  @HttpCode(200)
  async terminateAssignment(
    @Param('aggregatorId') aggregatorId: string,
    @Param('agentId') agentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    return this.relationshipService.unassign({ aggregatorId, agentId, actor });
  }

  private requirePrivileged(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    // Aggregator and Agent principals are not privileged; only SUPPORT/OPERATOR/SERVICE/PRIVILEGED can manage aggregators
    if (principal.type === 'AGENT' || principal.type === 'CUSTOMER' || (principal.type as string) === 'AGGREGATOR') {
      throw new UnauthorizedException('Privileged access required');
    }
    return principal.principalId;
  }
}
