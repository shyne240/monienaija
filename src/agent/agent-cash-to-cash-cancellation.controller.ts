import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentCashToCashCancellationService } from './agent-cash-to-cash-cancellation.service';

class CancelCashToCashDto {
  @IsString()
  @Length(1, 255)
  agentPin!: string;
}
@Controller('agents/cash-to-cash')
export class AgentCashToCashCancellationController {
  constructor(private readonly service: AgentCashToCashCancellationService) {}
  @Post(':transferId/cancel')
  @HttpCode(200)
  cancel(
    @Param('transferId') id: string,
    @Body() dto: CancelCashToCashDto,
    @Req() req: { authorizationPrincipal?: AuthorizationPrincipal },
  ) {
    if (!req.authorizationPrincipal) throw new UnauthorizedException('Agent session required');
    return this.service.cancel(id, dto.agentPin, req.authorizationPrincipal);
  }
}
