import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';

import { AgentCashInService } from './agent-cash-in.service';
import { CashInDto } from './dto/cash-in.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('agents')
export class AgentCashInController {
  constructor(private readonly cashInService: AgentCashInService) {}

  @Post('cash-in')
  @HttpCode(201)
  async cashIn(@Body() dto: CashInDto, @Req() req: AuthenticatedRequest) {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'AGENT' || !principal.agentId) {
      // Guard should have already denied, but fail-closed
      throw new Error('Agent authentication required');
    }
    const result = await this.cashInService.execute({
      agentId: principal.agentId,
      principal,
      pin: dto.pin,
      recipientIdentifier: dto.recipientIdentifier,
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
