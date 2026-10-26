import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Validate, ValidateIf } from 'class-validator';

import { normalizeCustomerText } from '../customer-validation';
import { CustomerFieldPolicyConstraint } from '../customer-validation.constraints';
import { AddressType } from '../customer.enums';

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

export class UpdateAddressDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(AddressType)
  type?: AddressType;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['freeText', 200])
  lineOne?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalTrimmedText(value))
  @Validate(CustomerFieldPolicyConstraint, ['freeText', 200])
  lineTwo?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['freeText', 100])
  city?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['freeText', 100])
  state?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Transform(({ value }: { value: unknown }) => normalizeCountry(value))
  @Validate(CustomerFieldPolicyConstraint, ['isoCountry'])
  country?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalTrimmedText(value))
  @Validate(CustomerFieldPolicyConstraint, ['postalCode'])
  postalCode?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  isPrimary?: boolean;
}
