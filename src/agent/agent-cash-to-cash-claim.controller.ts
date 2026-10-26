import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';

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
    const principal = req.authorizationPrincipal;
    // Allow both AGENT and CUSTOMER; if no principal, we still allow but pass through for service to handle
    const result = await this.claimService.execute({
      transferId: dto.transferId,
      beneficiaryPhone: dto.beneficiaryPhone,
      transferCode: dto.transferCode,
      customerId: dto.customerId,
      mfaChallengeId: dto.mfaChallengeId,
      otp: dto.otp,
      idempotencyKey: dto.idempotencyKey,
      claimantPrincipal: principal,
      reference: dto.reference,
      description: dto.description,
      correlationId: dto.correlationId,
      metadata: dto.metadata,
    });
    return result;
  }
}
