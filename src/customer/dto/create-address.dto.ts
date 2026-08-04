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

import { AddressType } from '../customer.enums';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateAddressDto {
  @IsEnum(AddressType)
  type!: AddressType;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(1)
  @MaxLength(200)
  lineOne!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MaxLength(200)
  lineTwo?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(1)
  @MaxLength(100)
  city!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(1)
  @MaxLength(100)
  state!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z]{2,3}$/)
  country!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MaxLength(20)
  postalCode?: string;

  @IsBoolean()
  isPrimary!: boolean;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
