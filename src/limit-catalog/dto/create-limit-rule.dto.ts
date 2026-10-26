import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { LimitDimension, LimitDirection } from '../limit-catalog.enums';

export class CreateLimitRuleDto {
  @IsString()
  @Matches(/^[A-Z0-9_][A-Z0-9_.-]{1,79}$/)
  @MaxLength(80)
  product!: string;

  @IsOptional()
  @IsEnum(LimitDirection)
  direction?: LimitDirection | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  channel?: string | null;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsEnum(LimitDimension)
  dimension!: LimitDimension;

  // For amount dimensions: string minor units. For count: leave null.
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  limitValueMinor?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limitValueCount?: number | null;

  @IsOptional()
  @IsString()
  effectiveFrom?: string | null; // ISO date string

  @IsOptional()
  @IsString()
  effectiveTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;
}
