import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentCashToCashRecoveryService } from './agent-cash-to-cash-recovery.service';
class RecoverFundingDto {
  @IsString() @Length(1, 255) idempotencyKey!: string;
}
@Controller('agents/cash-to-cash')
export class AgentCashToCashRecoveryController {
  constructor(private readonly service: AgentCashToCashRecoveryService) {}
  @Post('recover-funding')
  @HttpCode(200)
  recover(
    @Req() req: { authorizationPrincipal?: AuthorizationPrincipal },
    @Body() dto: RecoverFundingDto,
  ) {
    if (!req.authorizationPrincipal) throw new UnauthorizedException('Agent session required');
    return this.service.recover(req.authorizationPrincipal, dto.idempotencyKey);
  }
}
