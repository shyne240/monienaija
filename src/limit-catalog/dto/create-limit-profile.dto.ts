import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { LimitProfileConfigurationStatus, LimitProfileKind, LimitProfileStatus } from '../limit-catalog.enums';

export class CreateLimitProfileDto {
  @IsString()
  @Matches(/^[A-Z0-9_]{3,80}$/)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsEnum(LimitProfileKind)
  kind!: LimitProfileKind;

  @IsOptional()
  @IsEnum(LimitProfileStatus)
  status?: LimitProfileStatus;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(LimitProfileConfigurationStatus)
  configurationStatus?: LimitProfileConfigurationStatus;
}
