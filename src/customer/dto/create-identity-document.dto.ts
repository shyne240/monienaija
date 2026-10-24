import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Validate } from 'class-validator';

import { normalizeCustomerText, normalizeIsoCountryCode } from '../customer-validation';
import { CustomerFieldPolicyConstraint } from '../customer-validation.constraints';
import { IdentityDocumentType } from '../customer.enums';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? normalizeCustomerText(value) : value;
}

function normalizeCountry(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = normalizeIsoCountryCode(value);
  return normalized ?? normalizeCustomerText(value).toUpperCase();
}

function optionalTrimmedText(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  return normalizeCustomerText(value) || undefined;
}

export class CreateIdentityDocumentDto {
  @IsEnum(IdentityDocumentType)
  type!: IdentityDocumentType;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['identityDocumentNumber'])
  documentNumber!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => normalizeCountry(value))
  @Validate(CustomerFieldPolicyConstraint, ['identityDocumentCountry'])
  issuingCountry!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalTrimmedText(value))
  @Validate(CustomerFieldPolicyConstraint, ['identityDocumentDate'])
  issuedAt?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalTrimmedText(value))
  @Validate(CustomerFieldPolicyConstraint, ['identityDocumentDate'])
  expiresAt?: string;
}
