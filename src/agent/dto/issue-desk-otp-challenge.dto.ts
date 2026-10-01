import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { AGENT_DESK_OTP_PURPOSES, type AgentDeskOtpPurpose } from '../agent-desk-otp.constants';

/**
 * V1-AGENT-MFA-API-01 — request body for POST /agents/me/mfa-challenges.
 * The authenticated AGENT requests an OTP challenge FOR a co-present customer
 * (the OTP is delivered to the customer's verified primary phone; the agent
 * never receives it). Purpose is mandatory so the challenge cannot drift
 * between flows. TTL bounds mirror the canonical MFA service (30–900s, default 300).
 */
export class IssueDeskOtpChallengeDto {
  @IsUUID()
  customerId!: string;

  @IsIn(AGENT_DESK_OTP_PURPOSES as unknown as string[])
  purpose!: AgentDeskOtpPurpose;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(900)
  ttlSeconds?: number;
}
