import { Body, Controller, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CashOutReconciliationService } from './cash-out-reconciliation.service';
import { CashOutReconciliationDto } from './dto/cash-out-reconciliation.dto';
interface RequestWithPrincipal {
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller()
export class CashOutReconciliationController {
  constructor(
    private readonly service: CashOutReconciliationService,
    private readonly auth: AuthorizationService,
  ) {}
  @Post('agents/cash-out/reconciliation-handoff')
  handoff(@Req() req: RequestWithPrincipal, @Body() dto: CashOutReconciliationDto) {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'AGENT' || !principal.agentId)
      throw new UnauthorizedException('Agent authentication required');
    return this.service.handoff(principal, dto);
  }
  @Get('internal/reconciliation/cash-out/:agentId/:operationKey')
  async lookup(
    @Req() req: RequestWithPrincipal,
    @Param('agentId') agentId: string,
    @Param('operationKey') key: string,
  ) {
    await this.auth.requireFunction(
      req.authorizationPrincipal,
      'reconciliation.view',
      'internal-reconciliation',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    return this.service.lookup(agentId, key);
  }
}
