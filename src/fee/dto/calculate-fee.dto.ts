import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

import { QuotePaymentType } from '../../quote/quote.enums';

function normalizeMinorUnitInput(value: unknown): unknown {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  return typeof value === 'string' ? value.trim() : value;
}

export class CalculateFeeDto {
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

  @IsEnum(QuotePaymentType)
  paymentType!: QuotePaymentType;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^\d+$/)
  flatFeeMinor!: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^\d+$/)
  percentageBps!: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @IsOptional()
  @Matches(/^\d+$/)
  minimumFeeMinor?: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @IsOptional()
  @Matches(/^\d+$/)
  maximumFeeMinor?: string;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^\d+$/)
  vatBps!: string;
}
