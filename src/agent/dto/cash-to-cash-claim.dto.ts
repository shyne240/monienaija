import { Transform } from 'class-transformer';
import { IsEmpty, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength, Matches } from 'class-validator';
import type { AgentCashToCashRedemptionMethod } from '../agent-cash-to-cash-claim.types';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CashToCashClaimFields {
  @IsString()
  @Transform(({ value }) => trimString(value))
  @Length(1, 20)
  beneficiaryPhone!: string;

  @IsString()
  @Transform(({ value }) => trimString(value))
  @Length(8, 20)
  @Matches(/^\d+$/)
  transferCode!: string;

  @IsUUID()
  @Transform(({ value }) => trimString(value))
  customerId!: string;

  @IsUUID()
  @Transform(({ value }) => trimString(value))
  mfaChallengeId!: string;

  @IsString()
  @Transform(({ value }) => trimString(value))
  @Length(1, 512)
  otp!: string;

  @IsString()
  @Transform(({ value }) => trimString(value))
  @Length(1, 255)
  idempotencyKey!: string;

  @IsOptional()
  @IsIn(['CUSTOMER_WALLET', 'AGENT_CASH'])
  redemptionMethod?: AgentCashToCashRedemptionMethod;

  // Agent PIN is not trimmed because the existing PIN policy treats the submitted value as a secret.
  @IsOptional()
  @IsString()
  @Length(1, 255)
  agentPin?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimString(value))
  @MaxLength(255)
  reference?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimString(value))
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimString(value))
  @MaxLength(255)
  correlationId?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class CashToCashClaimDto extends CashToCashClaimFields {
  @IsUUID()
  @Transform(({ value }) => trimString(value))
  transferId!: string;
}

export class CashToCashLocatorDto {
  @IsString()
  @Transform(({ value }) => trimString(value))
  @Length(1, 20)
  senderPhone!: string;

  @IsString()
  @Matches(/^[0-9]{6}$/)
  transferNumber!: string;
}

export class CashToCashLocatorClaimDto extends CashToCashClaimFields {
  @IsEmpty()
  transferId?: never;

  @IsString()
  @Transform(({ value }) => trimString(value))
  @Length(1, 20)
  senderPhone!: string;

  @IsString()
  @Matches(/^[0-9]{6}$/)
  transferNumber!: string;
}

export class CashToCashLocatorRecoveryDto extends CashToCashLocatorDto {
  @IsString()
  @Length(1, 255)
  idempotencyKey!: string;
}
