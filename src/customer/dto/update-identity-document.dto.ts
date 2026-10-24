import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Validate, ValidateIf } from 'class-validator';

import { normalizeCustomerText } from '../customer-validation';
import { CustomerFieldPolicyConstraint } from '../customer-validation.constraints';
import { IdentityDocumentType } from '../customer.enums';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? normalizeCustomerText(value) : value;
}

function normalizeCountry(value: unknown): unknown {
  return typeof value === 'string' ? normalizeCustomerText(value).toUpperCase() : value;
}

function optionalTrimmedText(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  return normalizeCustomerText(value) || undefined;
}

export class UpdateIdentityDocumentDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(IdentityDocumentType)
  type?: IdentityDocumentType;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['freeText', 160])
  documentNumber?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Transform(({ value }: { value: unknown }) => normalizeCountry(value))
  @Validate(CustomerFieldPolicyConstraint, ['isoCountry'])
  issuingCountry?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalTrimmedText(value))
  @Validate(CustomerFieldPolicyConstraint, ['documentDate'])
  issuedAt?: string | null;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalTrimmedText(value))
  @Validate(CustomerFieldPolicyConstraint, ['documentDate'])
  expiresAt?: string | null;
}
