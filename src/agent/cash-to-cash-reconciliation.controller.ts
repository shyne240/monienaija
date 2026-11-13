import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IsIn, IsUUID } from 'class-validator';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  CashToCashReconciliationService,
  type HandoffReason,
} from './cash-to-cash-reconciliation.service';
class HandoffDto {
  @IsUUID() transferId!: string;
  @IsIn(['UNKNOWN_OUTCOME', 'RECEIPT_UNAVAILABLE', 'DISPOSITION_PENDING', 'EVIDENCE_REVIEW'])
  reason!: HandoffReason;
}
@Controller()
export class CashToCashReconciliationController {
  constructor(
    private readonly service: CashToCashReconciliationService,
    private readonly auth: AuthorizationService,
  ) {}
  @Post('agents/cash-to-cash/reconciliation-handoff')
  handoff(
    @Req() req: { authorizationPrincipal?: AuthorizationPrincipal },
    @Body() dto: HandoffDto,
  ) {
    if (!req.authorizationPrincipal)
      throw new UnauthorizedException('Agent authentication required');
    return this.service.handoff(req.authorizationPrincipal, dto.transferId, dto.reason);
  }
  @Get('internal/reconciliation/cash-to-cash/:handoffId')
  async lookup(
    @Req() req: { authorizationPrincipal?: AuthorizationPrincipal },
    @Param('handoffId') id: string,
  ) {
    await this.auth.requireFunction(
      req.authorizationPrincipal,
      'reconciliation.view',
      'internal-reconciliation',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    // A function grant alone does not establish institution-scoped entitlement.
    // Do not expose a cross-institution handoff until authoritative workforce scope exists.
    void id;
    throw new ServiceUnavailableException('Institutional reconciliation authorization unavailable');
  }
}
