import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { LedgerAccountType, LedgerNormalBalance } from '../ledger.enums';

export class CreateLedgerAccountDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,99}$/)
  code!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsEnum(LedgerAccountType)
  accountType!: LedgerAccountType;

  @IsEnum(LedgerNormalBalance)
  @IsOptional()
  normalBalance?: LedgerNormalBalance;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z][A-Z0-9_:-]{1,63}$/)
  accountingUnit?: string;

  @IsBoolean()
  @IsOptional()
  allowNegativeBalance?: boolean;
}
