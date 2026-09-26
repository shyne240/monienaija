import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length, MaxLength, Matches } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CashToCashClaimDto {
  @IsUUID()
  @Transform(({ value }) => trimString(value))
  transferId!: string;

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
