import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { IdentityDocumentType } from '../customer.enums';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateIdentityDocumentDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(IdentityDocumentType)
  type?: IdentityDocumentType;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  documentNumber?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z]{2,3}$/)
  issuingCountry?: string;

  @IsISO8601({ strict: true })
  @IsOptional()
  issuedAt?: string | null;

  @IsISO8601({ strict: true })
  @IsOptional()
  expiresAt?: string | null;
}
