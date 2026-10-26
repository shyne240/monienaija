import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';

import { AgentCashOutService } from './agent-cash-out.service';
import { CashOutDto } from './dto/cash-out.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('agents')
export class AgentCashOutController {
  constructor(private readonly cashOutService: AgentCashOutService) {}

  @Post('cash-out')
  @HttpCode(201)
  async cashOut(@Body() dto: CashOutDto, @Req() req: AuthenticatedRequest) {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'AGENT' || !principal.agentId) {
      throw new Error('Agent authentication required');
    }
    const result = await this.cashOutService.execute({
      agentId: principal.agentId,
      agentPrincipal: principal,
      agentPin: dto.agentPin,
      customerId: dto.customerId,
      customerPin: dto.customerPin,
      mfaChallengeId: dto.mfaChallengeId,
      otp: dto.otp,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: dto.idempotencyKey,
      reference: dto.reference,
      description: dto.description,
      correlationId: dto.correlationId,
      metadata: dto.metadata,
    });
    return result;
  }
}
