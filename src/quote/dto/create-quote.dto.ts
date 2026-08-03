import { Transform } from 'class-transformer';
import { IsEnum, IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { QuotePaymentType } from '../quote.enums';

function normalizeMinorUnitInput(value: unknown): unknown {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateQuoteDto {
  @IsEnum(QuotePaymentType)
  paymentType!: QuotePaymentType;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^[1-9]\d*$/)
  amountMinor!: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^\d+$/)
  feeMinor!: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^\d+$/)
  vatMinor!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @IsISO8601()
  expiresAt!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(255)
  idempotencyKey?: string;
}
