import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, Validate } from 'class-validator';

import { normalizeCustomerText, normalizeIsoCountryCode } from '../customer-validation';
import { CustomerFieldPolicyConstraint } from '../customer-validation.constraints';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? normalizeCustomerText(value) : value;
}

function normalizeCountry(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return normalizeIsoCountryCode(value) ?? normalizeCustomerText(value).toUpperCase();
}

/**
 * Input for the workforce-only manual-registration profile workflow. The customer type is
 * authoritative on the server: INDIVIDUAL requires first/last name; BUSINESS requires
 * businessName. Display/legal names are intentionally derived rather than entered separately.
 */
export class CreateRegistrationProfileDto {
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 200])
  businessName?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 100])
  firstName?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 100])
  middleName?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 100])
  lastName?: string;

  @IsISO8601({ strict: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['dateOfBirth'])
  dateOfBirth?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeCountry(value))
  @Validate(CustomerFieldPolicyConstraint, ['isoCountry'])
  nationality?: string;
}
