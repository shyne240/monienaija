import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { AgentCashToCashClaimService } from './agent-cash-to-cash-claim.service';
import { AgentDeskOtpService } from './agent-desk-otp.service';
import { IssueDeskOtpChallengeDto } from './dto/issue-desk-otp-challenge.dto';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-AGENT-MFA-API-01 — POST /agents/me/mfa-challenges.
 *
 * Route authorization (§4): governed by the RoutePolicyRegistry generic /agents/* rule —
 * NON-public, allowedPrincipalTypes ['AGENT'], agentAccess 'SELF', customerAccess 'NONE'.
 * Identity comes exclusively from the agent session (same requireAgentPrincipal pattern
 * as AgentAppController). Customer/workforce/unauthenticated actors are denied 401/403
 * by the runtime guard before reaching this controller.
 *
 * Issue-only surface: it never verifies, never reveals any OTP, and performs no
 * financial action.
 */
@Controller('agents/me')
export class AgentDeskOtpController {
  constructor(
    private readonly deskOtpService: AgentDeskOtpService,
    private readonly claimService: AgentCashToCashClaimService,
  ) {}

  @Post('mfa-challenges')
  @HttpCode(201)
  async issueMfaChallenge(@Req() req: AuthenticatedRequest, @Body() dto: IssueDeskOtpChallengeDto) {
    const principal = this.requireAgentPrincipal(req);
    const hasLocator = dto.senderPhone !== undefined || dto.transferNumber !== undefined;
    if (
      hasLocator &&
      (dto.purpose !== 'CASH_TO_CASH_CLAIM' ||
        dto.transferId ||
        !dto.senderPhone ||
        !dto.transferNumber)
    )
      throw new BadRequestException('Invalid claim context');
    const transferId = hasLocator
      ? await this.claimService.resolveLocatorForChallenge(
          dto.senderPhone!,
          dto.transferNumber!,
          principal,
        )
      : dto.transferId;
    try {
      return await this.deskOtpService.issue({
        agentId: principal.agentId!,
        agentSessionId: principal.sessionId,
        amountMinor: dto.amountMinor,
        currency: dto.currency,
        operationKey: dto.operationKey,
        supersedesOperationKey: dto.supersedesOperationKey,
        transferId,
        redemptionMethod: dto.redemptionMethod,
        customerId: dto.customerId,
        purpose: dto.purpose,
        ttlSeconds: dto.ttlSeconds,
      });
    } catch (error) {
      // A locator must not disclose transfer or recipient existence via preflight failures.
      if (
        hasLocator &&
        error instanceof HttpException &&
        error.getStatus() < 500 &&
        error.getStatus() !== 429
      )
        throw new NotFoundException({
          code: 'C2C_CLAIM_NOT_AVAILABLE',
          message: 'Claim not available',
        });
      throw error;
    }
  }

  private requireAgentPrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'AGENT' || !principal.agentId) {
      throw new UnauthorizedException('Agent authentication required');
    }
    return principal;
  }
}
