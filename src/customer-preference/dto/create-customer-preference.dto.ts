import { Transform, Type } from 'class-transformer';
import { IsEnum, IsString, ValidateNested, MaxLength, MinLength } from 'class-validator';

import { CustomerLanguage, CustomerTheme } from '../customer-preference.enums';
import { NotificationPreferenceDto } from './notification-preference.dto';
import { SecurityPreferenceDto } from './security-preference.dto';

export class CreateCustomerPreferenceDto {
  @IsEnum(CustomerLanguage)
  language!: CustomerLanguage;

  @IsEnum(CustomerTheme)
  theme!: CustomerTheme;

  @ValidateNested()
  @Type(() => NotificationPreferenceDto)
  notifications!: NotificationPreferenceDto;

  @ValidateNested()
  @Type(() => SecurityPreferenceDto)
  security!: SecurityPreferenceDto;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
