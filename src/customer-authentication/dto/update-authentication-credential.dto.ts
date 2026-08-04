import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { AuthenticationCredentialStatus } from '../customer-authentication.enums';

export class UpdateAuthenticationCredentialDto {
  @IsEnum(AuthenticationCredentialStatus)
  @IsOptional()
  status?: AuthenticationCredentialStatus;

  @IsISO8601()
  @IsOptional()
  passwordExpiresAt?: string;

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
