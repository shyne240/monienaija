import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CustomerOperatingPermissionType } from '../customer-eligibility.enums';

export class CreateCustomerOperatingPermissionDto {
  @IsEnum(CustomerOperatingPermissionType)
  type!: CustomerOperatingPermissionType;

  @IsBoolean()
  enabled!: boolean;

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
