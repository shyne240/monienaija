import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeMinorUnitInput(value: unknown): unknown {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateDepositDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  walletId!: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^[1-9]\d*$/)
  amountMinor!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(255)
  reference?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(255)
  narration?: string;
}
