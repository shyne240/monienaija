import { Body, Controller, HttpCode, Param, Post, Req, UnauthorizedException } from '@nestjs/common';

import { AgentFundingService } from './agent-funding.service';
import { FundAgentDto, DefundAgentDto } from './dto/fund-agent.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal')
export class AgentFundingController {
  constructor(private readonly fundingService: AgentFundingService) {}

  @Post('agents/:agentId/fund')
  @HttpCode(201)
  async fundAgent(
    @Param('agentId') agentId: string,
    @Body() dto: FundAgentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { principal, actor } = this.requirePrivileged(req);
    return this.fundingService.fund({
      agentId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: dto.idempotencyKey,
      reference: dto.reference,
      correlationId: dto.correlationId,
      description: dto.description,
      metadata: dto.metadata,
      principal,
      actor,
    });
  }

  @Post('agents/:agentId/defund')
  @HttpCode(201)
  async defundAgent(
    @Param('agentId') agentId: string,
    @Body() dto: DefundAgentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { principal, actor } = this.requirePrivileged(req);
    return this.fundingService.defund({
      agentId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: dto.idempotencyKey,
      reference: dto.reference,
      correlationId: dto.correlationId,
      description: dto.description,
      metadata: dto.metadata,
      principal,
      actor,
    });
  }

  @Post('aggregators/:aggregatorId/agents/:agentId/fund')
  @HttpCode(201)
  async fundViaAggregator(
    @Param('aggregatorId') aggregatorId: string,
    @Param('agentId') agentId: string,
    @Body() dto: FundAgentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { principal, actor } = this.requirePrivileged(req);
    // Allow both WORKFORCE and AGGREGATOR principals; for V1 we treat workforce as privileged funding via aggregator context
    // If principal is AGGREGATOR, its aggregatorId must match
    if (principal.type === 'AGGREGATOR' && principal.aggregatorId !== aggregatorId) {
      throw new UnauthorizedException('Aggregator principal mismatch');
    }
    return this.fundingService.fund({
      agentId,
      aggregatorId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: dto.idempotencyKey,
      reference: dto.reference,
      correlationId: dto.correlationId,
      description: dto.description,
      metadata: dto.metadata,
      principal,
      actor,
    });
  }

  @Post('aggregators/:aggregatorId/agents/:agentId/defund')
  @HttpCode(201)
  async defundViaAggregator(
    @Param('aggregatorId') aggregatorId: string,
    @Param('agentId') agentId: string,
    @Body() dto: DefundAgentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { principal, actor } = this.requirePrivileged(req);
    if (principal.type === 'AGGREGATOR' && principal.aggregatorId !== aggregatorId) {
      throw new UnauthorizedException('Aggregator principal mismatch');
    }
    return this.fundingService.defund({
      agentId,
      aggregatorId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: dto.idempotencyKey,
      reference: dto.reference,
      correlationId: dto.correlationId,
      description: dto.description,
      metadata: dto.metadata,
      principal,
      actor,
    });
  }

  private requirePrivileged(req: AuthenticatedRequest): { principal: AuthorizationPrincipal; actor: string } {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'AGENT' || principal.type === 'CUSTOMER') {
      throw new UnauthorizedException('Privileged access required');
    }
    // For V1, Aggregator direct authentication is not yet implemented as login, but we allow AGGREGATOR principal if it arrives via workforce assertion
    // Do not allow anonymous
    return { principal, actor: principal.principalId };
  }
}
