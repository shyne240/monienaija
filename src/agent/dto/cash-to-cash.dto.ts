import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeMinorUnitInput(value: unknown): unknown {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  return typeof value === 'string' ? value.trim() : value;
}

export class CashToCashDto {
  @IsString()
  @Transform(({ value }) => trimString(value))
  @Length(1, 20)
  beneficiaryPhone!: string;

  @Transform(({ value }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^[1-9]\d*$/)
  amountMinor!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsString()
  @Transform(({ value }) => trimString(value))
  @Length(1, 255)
  idempotencyKey!: string;

  @IsString()
  @Transform(({ value }) => trimString(value))
  @Length(1, 255)
  agentPin!: string;

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
