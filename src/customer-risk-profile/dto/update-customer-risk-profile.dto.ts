import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CustomerRiskLevel, CustomerRiskProfileStatus } from '../customer-risk-profile.enums';
import { UpdateRiskFactorDto } from './risk-factor.dto';

export class UpdateCustomerRiskProfileDto {
  @IsEnum(CustomerRiskProfileStatus)
  @IsOptional()
  status?: CustomerRiskProfileStatus;

  @IsISO8601()
  @IsOptional()
  assessmentDate?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  assessedBy?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(120)
  assessmentMethod?: string;

  @IsEnum(CustomerRiskLevel)
  @IsOptional()
  overallRiskLevel?: CustomerRiskLevel;

  @IsISO8601()
  @IsOptional()
  reviewDueDate?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateRiskFactorDto)
  @IsOptional()
  factors?: UpdateRiskFactorDto[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  version?: number;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
