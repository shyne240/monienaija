import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PasswordHashAlgorithm } from '../customer-authentication.enums';

export class CreateAuthenticationCredentialDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(512)
  @Matches(/^\S+$/)
  passwordHash!: string;

  @IsEnum(PasswordHashAlgorithm)
  hashAlgorithm!: PasswordHashAlgorithm;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  passwordVersion!: number;

  @IsISO8601()
  @IsOptional()
  passwordExpiresAt?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
