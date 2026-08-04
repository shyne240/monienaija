import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { CustomerBeneficiaryType } from '../customer-beneficiary.enums';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateCustomerBeneficiaryDto {
  @IsEnum(CustomerBeneficiaryType)
  type!: CustomerBeneficiaryType;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MinLength(1)
  @MaxLength(160)
  @Matches(/^[a-z0-9][a-z0-9_.:-]{0,159}$/)
  reference!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  destinationIdentifier!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MaxLength(200)
  destinationName?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MaxLength(200)
  destinationInstitution?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MaxLength(120)
  nickname?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
