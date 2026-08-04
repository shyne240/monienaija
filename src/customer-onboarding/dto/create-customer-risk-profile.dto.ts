import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CustomerRiskLevel } from '../customer-onboarding.enums';

export class CreateCustomerRiskProfileDto {
  @IsEnum(CustomerRiskLevel)
  riskLevel!: CustomerRiskLevel;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(500)
  rationale?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  assessedBy!: string;
}
