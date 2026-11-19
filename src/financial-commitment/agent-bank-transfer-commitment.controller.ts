import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { FinancialCommitmentService } from './financial-commitment.service';

class InitiateAgentBankTransferDto {
  @IsOptional()
  @IsUUID()
  walletAccountId?: string;

  @IsUUID()
  beneficiaryId!: string;

  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  amountMinor!: string;

  @IsString()
  @Matches(/^NGN$/)
  currency!: string;

  @IsString()
  @Matches(/^\d{4,12}$/)
  @MaxLength(12)
  pin!: string;
}

interface AgentRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * Agent-self bank transfers. The agent id and session come from the authenticated principal — a
 * caller cannot initiate a transfer for somebody else, and the optional `walletAccountId` is only a
 * locator for the agent's OWN operating wallet (re-validated server-side). Not a workforce route,
 * not a treasury action, and never restricted to the agent's own personal bank account: any valid
 * external bank beneficiary the agent has added may be addressed, exactly as for customer bank
 * withdrawals.
 */
@Controller('agents/me/banking/bank-transfers')
export class AgentBankTransferCommitmentController {
  constructor(private readonly commitments: FinancialCommitmentService) {}

  @Post()
  @HttpCode(201)
  async initiate(
    @Body() dto: InitiateAgentBankTransferDto,
    @Req() req: AgentRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'AGENT' || !principal.agentId || !principal.sessionId)
      throw new UnauthorizedException('Agent session required');
    const result = await this.commitments.initiateForAgent({
      agentId: principal.agentId,
      agentSessionId: principal.sessionId,
      principal,
      pin: dto.pin,
      walletAccountId: dto.walletAccountId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      beneficiaryId: dto.beneficiaryId,
      idempotencyKey: idempotencyKey ?? '',
    });
    return {
      commitmentId: result.commitment.id,
      withdrawalId: result.commitment.withdrawal_id,
      externalOperationId: result.commitment.external_operation_id,
      state: result.commitment.state,
      replayed: result.replayed,
      /** Null when no banking dispatch intent exists for this commitment. */
      operationReference: result.operationReference,
    };
  }
}
