import { Transform } from 'class-transformer';
import { IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { QuotePaymentType } from '../../quote/quote.enums';

function normalizeMinorUnitInput(value: unknown): unknown {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  return typeof value === 'string' ? value.trim() : value;
}

export class EvaluateLimitDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  customerId!: string;

  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  walletId!: string;

  @IsEnum(QuotePaymentType)
  paymentType!: QuotePaymentType;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^[1-9]\d*$/)
  amountMinor!: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^\d+$/)
  singleTransactionLimitMinor!: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^\d+$/)
  dailyLimitMinor!: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^\d+$/)
  monthlyLimitMinor!: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^\d+$/)
  dailyUsedMinor!: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^\d+$/)
  monthlyUsedMinor!: string;
}
