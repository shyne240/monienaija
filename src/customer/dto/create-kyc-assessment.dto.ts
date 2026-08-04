import { Transform } from 'class-transformer';
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CustomerKycLevel, CustomerKycStatus } from '../customer.enums';

export class CreateKycAssessmentDto {
  @IsEnum(CustomerKycLevel)
  level!: CustomerKycLevel;

  @IsEnum(CustomerKycStatus)
  status!: CustomerKycStatus;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(500)
  reason?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  assessedBy!: string;

  @IsISO8601()
  @IsOptional()
  expiresAt?: string;
}
