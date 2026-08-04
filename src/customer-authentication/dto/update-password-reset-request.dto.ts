import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

import { PasswordResetRequestStatus } from '../customer-authentication.enums';

export class UpdatePasswordResetRequestDto {
  @IsEnum(PasswordResetRequestStatus)
  status!: PasswordResetRequestStatus;

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
