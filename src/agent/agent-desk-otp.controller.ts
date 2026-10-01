import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';

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
  constructor(private readonly deskOtpService: AgentDeskOtpService) {}

  @Post('mfa-challenges')
  @HttpCode(201)
  async issueMfaChallenge(@Req() req: AuthenticatedRequest, @Body() dto: IssueDeskOtpChallengeDto) {
    const principal = this.requireAgentPrincipal(req);
    return this.deskOtpService.issue({
      agentId: principal.agentId!,
      customerId: dto.customerId,
      purpose: dto.purpose,
      ttlSeconds: dto.ttlSeconds,
    });
  }

  private requireAgentPrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'AGENT' || !principal.agentId) {
      throw new UnauthorizedException('Agent authentication required');
    }
    return principal;
  }
}
