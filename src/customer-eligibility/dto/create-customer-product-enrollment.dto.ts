import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';

import { CustomerProductEnrollmentStatus } from '../customer-eligibility.enums';

export class CreateCustomerProductEnrollmentDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9_.:-]{0,79}$/)
  product!: string;

  @IsEnum(CustomerProductEnrollmentStatus)
  @IsOptional()
  status: CustomerProductEnrollmentStatus = CustomerProductEnrollmentStatus.PENDING;

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
