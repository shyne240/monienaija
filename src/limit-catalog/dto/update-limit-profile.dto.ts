import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

import { LimitProfileConfigurationStatus, LimitProfileKind, LimitProfileStatus } from '../limit-catalog.enums';

export class UpdateLimitProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsEnum(LimitProfileKind)
  kind?: LimitProfileKind;

  @IsOptional()
  @IsEnum(LimitProfileStatus)
  status?: LimitProfileStatus;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(LimitProfileConfigurationStatus)
  configurationStatus?: LimitProfileConfigurationStatus;

  @IsInt()
  @Min(1)
  version!: number;
}
