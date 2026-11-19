import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { BankingAgentFundingService } from './banking-agent-funding.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * Agent banking surface.
 *
 * Every route is AGENT SELF: the agent id comes from the session and is never accepted from the
 * request, so there is no parameter an agent could change to address another agent's funding account.
 * The wallet id *is* accepted, but ownership is re-checked against the session inside the service —
 * the path is a locator, not an authorization.
 *
 * These routes are read-and-provision only. No route here moves money, and none of them reports a
 * credit that the inbound verification path has not already proven.
 */
@Controller('agents/me/banking')
export class BankingAgentController {
  constructor(private readonly funding: BankingAgentFundingService) {}

  private agentOf(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'AGENT' || !principal.agentId) {
      throw new UnauthorizedException('Agent authentication required');
    }
    return principal.agentId;
  }

  /** The funding account the agent's float should be sent to, or the honest state of not having one. */
  @Get('funding-account')
  async fundingAccount(@Req() req: AuthenticatedRequest, @Query('walletId') walletId?: string) {
    const agentId = this.agentOf(req);
    if (!walletId) throw new BadRequestException('walletId is required');
    return this.funding.view(agentId, walletId);
  }

  /** Requests provisioning. A second call cannot create a second account: the reference is derived. */
  @Post('funding-account')
  async provision(@Req() req: AuthenticatedRequest, @Query('walletId') walletId?: string) {
    const agentId = this.agentOf(req);
    if (!walletId) throw new BadRequestException('walletId is required');
    return this.funding.provision(agentId, walletId);
  }

  /** Verified funds that arrived in the funding account. Awaits float credit as a distinct state. */
  @Get('funding-account/:walletId/deposits')
  async deposits(
    @Req() req: AuthenticatedRequest,
    @Param('walletId') walletId: string,
    @Query('limit') limit?: string,
  ) {
    const agentId = this.agentOf(req);
    const parsed = limit === undefined ? 50 : Number(limit);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) {
      throw new BadRequestException('limit must be between 1 and 200');
    }
    return this.funding.receivedFunds(agentId, walletId, parsed);
  }

  @Get('transfers/:operationReference')
  async transfer(
    @Req() req: AuthenticatedRequest,
    @Param('operationReference') operationReference: string,
  ) {
    const agentId = this.agentOf(req);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(operationReference)) {
      throw new BadRequestException('operationReference is invalid');
    }
    const record = await this.funding.transferForAgent(agentId, operationReference);
    if (!record) throw new NotFoundException('Transfer not found');
    return record;
  }
}
