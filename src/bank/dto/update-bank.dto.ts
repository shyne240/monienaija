import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { BankStatus } from '../bank.enums';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateBankDto {
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MinLength(2)
  @MaxLength(160)
  bankName?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MinLength(2)
  @MaxLength(80)
  shortName?: string;

  @IsBoolean()
  @IsOptional()
  nipSupported?: boolean;

  @IsEnum(BankStatus)
  @IsOptional()
  status?: BankStatus;
}
