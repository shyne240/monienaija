import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { BankStatus } from '../bank.enums';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateBankDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{3,20}$/)
  bankCode!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MinLength(2)
  @MaxLength(160)
  bankName!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MinLength(2)
  @MaxLength(80)
  shortName!: string;

  @IsBoolean()
  nipSupported!: boolean;

  @IsEnum(BankStatus)
  status!: BankStatus;
}
