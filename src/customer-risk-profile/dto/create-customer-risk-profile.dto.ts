import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CustomerRiskLevel } from '../customer-risk-profile.enums';
import { RiskFactorDto } from './risk-factor.dto';

export class CreateCustomerRiskProfileDto {
  @IsISO8601()
  assessmentDate!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  assessedBy!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(120)
  assessmentMethod!: string;

  @IsEnum(CustomerRiskLevel)
  overallRiskLevel!: CustomerRiskLevel;

  @IsISO8601()
  reviewDueDate!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RiskFactorDto)
  factors!: RiskFactorDto[];

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
