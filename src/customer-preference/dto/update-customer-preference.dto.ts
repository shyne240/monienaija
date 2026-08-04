import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CustomerLanguage, CustomerTheme } from '../customer-preference.enums';
import { UpdateNotificationPreferenceDto } from './notification-preference.dto';
import { UpdateSecurityPreferenceDto } from './security-preference.dto';

export class UpdateCustomerPreferenceDto {
  @IsEnum(CustomerLanguage)
  @IsOptional()
  language?: CustomerLanguage;

  @IsEnum(CustomerTheme)
  @IsOptional()
  theme?: CustomerTheme;

  @ValidateNested()
  @Type(() => UpdateNotificationPreferenceDto)
  @IsOptional()
  notifications?: UpdateNotificationPreferenceDto;

  @ValidateNested()
  @Type(() => UpdateSecurityPreferenceDto)
  @IsOptional()
  security?: UpdateSecurityPreferenceDto;

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
