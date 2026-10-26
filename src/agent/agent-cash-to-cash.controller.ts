import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';

import { AgentCashToCashService } from './agent-cash-to-cash.service';
import { CashToCashDto } from './dto/cash-to-cash.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('agents')
export class AgentCashToCashController {
  constructor(private readonly cashToCashService: AgentCashToCashService) {}

  @Post('cash-to-cash')
  @HttpCode(201)
  async cashToCash(@Body() dto: CashToCashDto, @Req() req: AuthenticatedRequest) {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'AGENT' || !principal.agentId) {
      throw new Error('Agent authentication required');
    }
    const result = await this.cashToCashService.execute({
      agentId: principal.agentId,
      agentPrincipal: principal,
      agentPin: dto.agentPin,
      beneficiaryPhone: dto.beneficiaryPhone,
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
