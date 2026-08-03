import { Transform } from 'class-transformer';
import { IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { BeneficiaryType } from '../beneficiary.enums';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateBeneficiaryDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MinLength(1)
  @MaxLength(160)
  customerId!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MinLength(1)
  @MaxLength(100)
  nickname!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{3,20}$/)
  bankCode!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @Matches(/^\d{4,32}$/)
  accountNumber!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MinLength(2)
  @MaxLength(160)
  accountName!: string;

  @IsEnum(BeneficiaryType)
  type!: BeneficiaryType;
}
