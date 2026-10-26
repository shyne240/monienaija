import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { AgentCashToCashClaimService } from './agent-cash-to-cash-claim.service';
import { CashToCashClaimDto } from './dto/cash-to-cash-claim.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
  user?: { id: string };
}

@Controller('agents')
export class AgentCashToCashClaimController {
  constructor(private readonly claimService: AgentCashToCashClaimService) {}

  @Post('cash-to-cash/claim')
  @HttpCode(200)
  async claim(@Body() dto: CashToCashClaimDto, @Req() req: AuthenticatedRequest) {
    const principal = this.requireAgent(req);
    return this.claimService.execute({
      transferId: dto.transferId,
      beneficiaryPhone: dto.beneficiaryPhone,
      transferCode: dto.transferCode,
      customerId: dto.customerId,
      mfaChallengeId: dto.mfaChallengeId,
      otp: dto.otp,
      idempotencyKey: dto.idempotencyKey,
      claimantPrincipal: principal,
      redemptionMethod: dto.redemptionMethod,
      agentPin: dto.agentPin,
      reference: dto.reference,
      description: dto.description,
      correlationId: dto.correlationId,
      metadata: dto.metadata,
    });
  }

  /** Recover the receipt for a claim committed by this Agent after a lost response. */
  @Get('cash-to-cash/claims/:transferId')
  async recoverClaim(@Param('transferId') transferId: string, @Req() req: AuthenticatedRequest) {
    return this.claimService.recoverClaimForAgent(transferId, this.requireAgent(req));
  }

  private requireAgent(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Agent authentication required');
    if (
      principal.type !== 'AGENT' ||
      !principal.agentId ||
      principal.agentId.toLowerCase() !== principal.principalId.toLowerCase()
    ) {
      throw new ForbiddenException('Agent authentication required');
    }
    return principal;
  }
}
