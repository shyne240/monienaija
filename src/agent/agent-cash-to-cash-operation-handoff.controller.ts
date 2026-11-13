import { Body, Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  AgentCashToCashOperationHandoffService,
  type OperationHandoffReason,
} from './agent-cash-to-cash-operation-handoff.service';
class OperationHandoffDto {
  @IsString() @Length(1, 255) idempotencyKey!: string;
  @IsIn(['UNKNOWN_OUTCOME', 'LOST_TRANSFER_CODE', 'EVIDENCE_REVIEW'])
  reason!: OperationHandoffReason;
}
@Controller('agents/cash-to-cash')
export class AgentCashToCashOperationHandoffController {
  constructor(private readonly service: AgentCashToCashOperationHandoffService) {}
  @Post('operation-handoff')
  handoff(
    @Req() req: { authorizationPrincipal?: AuthorizationPrincipal },
    @Body() dto: OperationHandoffDto,
  ) {
    if (!req.authorizationPrincipal)
      throw new UnauthorizedException('Agent authentication required');
    return this.service.handoff(req.authorizationPrincipal, dto.idempotencyKey, dto.reason);
  }
}
