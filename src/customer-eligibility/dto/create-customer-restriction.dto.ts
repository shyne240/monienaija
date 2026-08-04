import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CustomerRestrictionType } from '../customer-eligibility.enums';

export class CreateCustomerRestrictionDto {
  @IsEnum(CustomerRestrictionType)
  type!: CustomerRestrictionType;

  @IsBoolean()
  isActive!: boolean;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(500)
  reason?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
