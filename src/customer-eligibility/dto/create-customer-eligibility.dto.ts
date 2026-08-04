import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CustomerEligibilityStatus } from '../customer-eligibility.enums';

export class CreateCustomerEligibilityDto {
  @IsEnum(CustomerEligibilityStatus)
  @IsOptional()
  status: CustomerEligibilityStatus = CustomerEligibilityStatus.PENDING;

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
