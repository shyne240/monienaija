import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { IdentityDocumentType } from '../customer.enums';

export class CreateIdentityDocumentDto {
  @IsEnum(IdentityDocumentType)
  type!: IdentityDocumentType;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  documentNumber!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z]{2,3}$/)
  issuingCountry!: string;

  @IsISO8601({ strict: true })
  @IsOptional()
  issuedAt?: string;

  @IsISO8601({ strict: true })
  @IsOptional()
  expiresAt?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
