import { IsBoolean, IsOptional } from 'class-validator';

export class SecurityPreferenceDto {
  @IsBoolean()
  loginAlerts!: boolean;

  @IsBoolean()
  transactionAlerts!: boolean;

  @IsBoolean()
  deviceRegistrationAlerts!: boolean;

  @IsBoolean()
  biometricAllowed!: boolean;
}

export class UpdateSecurityPreferenceDto {
  @IsBoolean()
  @IsOptional()
  loginAlerts?: boolean;

  @IsBoolean()
  @IsOptional()
  transactionAlerts?: boolean;

  @IsBoolean()
  @IsOptional()
  deviceRegistrationAlerts?: boolean;

  @IsBoolean()
  @IsOptional()
  biometricAllowed?: boolean;
}
