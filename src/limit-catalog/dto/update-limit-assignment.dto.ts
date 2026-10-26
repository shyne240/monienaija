import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { LimitAssignmentSubjectType } from '../limit-catalog.enums';

export class UpdateLimitAssignmentDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{3,80}$/)
  limitProfileCode?: string;

  @IsOptional()
  @IsEnum(LimitAssignmentSubjectType)
  subjectType?: LimitAssignmentSubjectType;

  @IsOptional()
  @IsUUID()
  subjectId?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{3,80}$/)
  @MaxLength(80)
  segmentCode?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  precedence?: number;

  @IsOptional()
  @IsString()
  effectiveFrom?: string | null;

  @IsOptional()
  @IsString()
  effectiveTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsInt()
  @Min(1)
  version!: number;
}
