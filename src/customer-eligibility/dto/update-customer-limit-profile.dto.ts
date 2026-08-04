import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function nonNegativeInteger(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateCustomerLimitProfileDto {
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  @IsOptional()
  dailyTransactionCount?: number;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => nonNegativeInteger(value))
  @Matches(/^\d+$/)
  @MaxLength(19)
  dailyTransactionAmountMinor?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => nonNegativeInteger(value))
  @Matches(/^\d+$/)
  @MaxLength(19)
  singleTransactionAmountMinor?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => nonNegativeInteger(value))
  @Matches(/^\d+$/)
  @MaxLength(19)
  monthlyTransactionAmountMinor?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => nonNegativeInteger(value))
  @Matches(/^\d+$/)
  @MaxLength(19)
  walletBalanceMinor?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  version?: number;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
