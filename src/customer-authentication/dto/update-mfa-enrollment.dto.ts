import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

import { MfaEnrollmentStatus } from '../customer-authentication.enums';

export class UpdateMfaEnrollmentDto {
  @IsEnum(MfaEnrollmentStatus)
  status!: MfaEnrollmentStatus;

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
