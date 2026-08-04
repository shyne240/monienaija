import { Transform, Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class IssuePasswordResetTokenDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(512)
  @Matches(/^\S+$/)
  tokenHash!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  tokenVersion!: number;

  @IsISO8601()
  expiresAt!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
