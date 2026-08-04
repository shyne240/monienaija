import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRecoveryCodeDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(512)
  @Matches(/^\S+$/)
  codeHash!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  codeVersion!: number;

  @IsUUID()
  @IsOptional()
  enrollmentId?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
