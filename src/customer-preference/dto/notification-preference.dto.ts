import { IsBoolean, IsOptional } from 'class-validator';

export class NotificationPreferenceDto {
  @IsBoolean()
  email!: boolean;

  @IsBoolean()
  sms!: boolean;

  @IsBoolean()
  push!: boolean;

  @IsBoolean()
  inApp!: boolean;
}

export class UpdateNotificationPreferenceDto {
  @IsBoolean()
  @IsOptional()
  email?: boolean;

  @IsBoolean()
  @IsOptional()
  sms?: boolean;

  @IsBoolean()
  @IsOptional()
  push?: boolean;

  @IsBoolean()
  @IsOptional()
  inApp?: boolean;
}
