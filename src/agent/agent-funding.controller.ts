import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentFundingService, type FundingInput } from './agent-funding.service';
import { RequestAgentFundingDto, RejectAgentFundingRequestDto } from './dto/agent-funding-request.dto';
import { DefundAgentDto, FundAgentDto } from './dto/fund-agent.dto';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal')
export class AgentFundingController {
  constructor(
    private readonly fundingService: AgentFundingService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  /** Maker endpoint: persist an instruction and linked approval request; never post a journal. */
  @Post('agents/:agentId/fund-request')
  @HttpCode(201)
  async requestFunding(
    @Param('agentId') agentId: string,
    @Body() dto: RequestAgentFundingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = await this.requireFunction(req, 'agent.fund');
    return this.fundingService.requestFunding(
      this.toFundingInput(agentId, dto, principal),
      'FUND',
      dto.reason,
    );
  }

  /** Maker endpoint for an approved, independent defunding instruction. */
  @Post('agents/:agentId/defund-request')
  @HttpCode(201)
  async requestDefunding(
    @Param('agentId') agentId: string,
    @Body() dto: RequestAgentFundingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = await this.requireFunction(req, 'agent.defund');
    return this.fundingService.requestFunding(
      this.toFundingInput(agentId, dto, principal),
      'DEFUND',
      dto.reason,
    );
  }

  /**
   * V1-SPRINT2-FUNDING-INBOX-01: global checker inbox — read-only discovery of funding and
   * defunding requests awaiting independent review, with server-side filtering and
   * pagination. Restricted to the Decision 7 checker identity (non-SUPER_ADMIN
   * FINANCE_CONTROLLER, MFA, agent.fund + agent.defund APPROVE grants) by both the route
   * policy and AgentFundingService.assertCheckerPrincipal. The caller's own maker requests
   * are excluded server-side. Grants no Agent Network function and mutates nothing.
   */
  @Get('agents/funding-requests')
  async listGlobalFundingRequests(
    @Query('status') status: string | undefined,
    @Query('direction') direction: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = await this.requireFundingChecker(req);
    if (status !== undefined && !['PENDING', 'REJECTED', 'EXECUTED'].includes(status)) {
      throw new BadRequestException("status must be one of PENDING, REJECTED, EXECUTED");
    }
    if (direction !== undefined && !['FUND', 'DEFUND'].includes(direction)) {
      throw new BadRequestException("direction must be one of FUND, DEFUND");
    }
    return this.fundingService.listGlobalFundingRequests(principal, {
      ...(status !== undefined ? { status: status as 'PENDING' | 'REJECTED' | 'EXECUTED' } : {}),
      ...(direction !== undefined ? { direction: direction as 'FUND' | 'DEFUND' } : {}),
      ...(page !== undefined ? { page: Number(page) } : {}),
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
    });
  }

  @Get('agents/:agentId/funding-requests')
  async listFundingRequests(
    @Param('agentId') agentId: string,
    @Query('idempotencyKey') idempotencyKey: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.fundingService.listFundingRequests(
      agentId,
      this.requirePrincipal(req),
      idempotencyKey,
    );
  }

  /**
   * Existing route now has two safe modes: without approvalId it creates a maker request; with
   * approvalId it executes only the matching, independently approved stored request. The DTO
   * body is re-bound to the persisted fingerprint before any posting can occur.
   */
  @Post('agents/:agentId/fund')
  @HttpCode(201)
  async fundAgent(
    @Param('agentId') agentId: string,
    @Body() dto: FundAgentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = await this.requireFunction(req, 'agent.fund');
    const input = this.toFundingInput(agentId, dto, principal);
    if (!dto.approvalId) {
      throw new ForbiddenException('A matching independent funding approval is required');
    }
    const instruction = await this.fundingService.getFundingRequest(dto.approvalId);
    if (instruction.agentId !== agentId || instruction.direction !== 'FUND') {
      throw new ForbiddenException('Approval is not bound to this Agent funding route');
    }
    return this.fundingService.executeApprovedRequest(dto.approvalId, principal, input);
  }

  @Post('agents/:agentId/defund')
  @HttpCode(201)
  async defundAgent(
    @Param('agentId') agentId: string,
    @Body() dto: DefundAgentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = await this.requireFunction(req, 'agent.defund');
    const input = this.toFundingInput(agentId, dto, principal);
    if (!dto.approvalId) {
      throw new ForbiddenException('A matching independent defunding approval is required');
    }
    const instruction = await this.fundingService.getFundingRequest(dto.approvalId);
    if (instruction.agentId !== agentId || instruction.direction !== 'DEFUND') {
      throw new ForbiddenException('Approval is not bound to this Agent defunding route');
    }
    return this.fundingService.executeApprovedRequest(dto.approvalId, principal, input);
  }

  @Post('aggregators/:aggregatorId/agents/:agentId/fund')
  @HttpCode(201)
  async fundViaAggregator(
    @Param('aggregatorId') aggregatorId: string,
    @Param('agentId') agentId: string,
    @Body() dto: FundAgentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = await this.requireFunction(req, 'agent.fund');
    const input = this.toFundingInput(agentId, dto, principal, aggregatorId);
    if (dto.approvalId) {
      const instruction = await this.fundingService.getFundingRequest(dto.approvalId);
      if (
        instruction.agentId !== agentId ||
        instruction.aggregatorId !== aggregatorId ||
        instruction.direction !== 'FUND'
      ) {
        throw new ForbiddenException('Approval is not bound to this Aggregator funding route');
      }
      return this.fundingService.executeApprovedRequest(dto.approvalId, principal, input);
    }
    return this.fundingService.fund(input);
  }

  @Post('aggregators/:aggregatorId/agents/:agentId/defund')
  @HttpCode(201)
  async defundViaAggregator(
    @Param('aggregatorId') aggregatorId: string,
    @Param('agentId') agentId: string,
    @Body() dto: DefundAgentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = await this.requireFunction(req, 'agent.defund');
    const input = this.toFundingInput(agentId, dto, principal, aggregatorId);
    if (dto.approvalId) {
      const instruction = await this.fundingService.getFundingRequest(dto.approvalId);
      if (
        instruction.agentId !== agentId ||
        instruction.aggregatorId !== aggregatorId ||
        instruction.direction !== 'DEFUND'
      ) {
        throw new ForbiddenException('Approval is not bound to this Aggregator defunding route');
      }
      return this.fundingService.executeApprovedRequest(dto.approvalId, principal, input);
    }
    return this.fundingService.defund(input);
  }

  /**
   * Execute a funding request after its linked PrivilegedActionApproval has been approved by a
   * different FINANCE_CONTROLLER. Approval consumption and ledger posting commit together.
   */
  @Post('agents/funding-requests/:requestId/execute')
  @HttpCode(201)
  async executeApprovedRequest(
    @Param('requestId') requestId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    // Direction lives in the request row, so authorize against the stable Decision 7
    // checker policy before any request lookup. A maker/non-checker receives the same
    // denial for an existing and a nonexistent identifier.
    const principal = await this.requireFundingChecker(req);
    return this.fundingService.executeApprovedRequest(requestId, principal);
  }

  @Post('agents/funding-requests/:requestId/reject')
  @HttpCode(201)
  async rejectFundingRequest(
    @Param('requestId') requestId: string,
    @Body() dto: RejectAgentFundingRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // As with execution, resolve the caller's authority without consulting request data.
    const principal = await this.requireFundingChecker(req);
    return this.fundingService.rejectFundingRequest(requestId, principal, dto.reason);
  }

  private toFundingInput(
    agentId: string,
    dto: FundAgentDto,
    principal: AuthorizationPrincipal,
    aggregatorId?: string,
  ): FundingInput {
    return {
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
      actor: principal.principalId,
    };
  }

  private async requireFundingChecker(req: AuthenticatedRequest): Promise<AuthorizationPrincipal> {
    const principal = this.requirePrincipal(req);
    if (
      principal.roles.includes('SUPER_ADMIN') ||
      !principal.roles.includes('FINANCE_CONTROLLER') ||
      principal.assuranceLevel !== 'MFA'
    ) {
      throw new ForbiddenException(
        'A non-SUPER_ADMIN FINANCE_CONTROLLER with MFA is required to review agent funding requests',
      );
    }

    // The direction is stored in the protected row. Require both Decision 7 review
    // functions up front rather than reading the row to choose one. Seeded controllers
    // hold both; maker access to either function is not checker authority.
    for (const functionCode of ['agent.fund', 'agent.defund'] as const) {
      await this.authorizationService.requireFunction(
        principal,
        functionCode,
        'agent-funding',
        ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
      );
    }
    return principal;
  }

  private async requireFunction(
    req: AuthenticatedRequest,
    functionCode: 'agent.fund' | 'agent.defund',
  ): Promise<AuthorizationPrincipal> {
    const principal = this.requirePrincipal(req);
    await this.authorizationService.requireFunction(
      principal,
      functionCode,
      'agent-funding',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    return principal;
  }

  private requirePrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (!['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
      throw new ForbiddenException('Workforce access required');
    }
    return principal;
  }
}
