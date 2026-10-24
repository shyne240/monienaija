import { Transform } from 'class-transformer';
import { IsOptional, IsString, Validate } from 'class-validator';

import {
  normalizeCustomerText,
  normalizeIsoCountryCode,
} from '../customer-validation';
import { CustomerFieldPolicyConstraint } from '../customer-validation.constraints';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? normalizeCustomerText(value) : value;
}

function normalizeCountry(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = normalizeIsoCountryCode(value);
  return normalized ?? normalizeCustomerText(value).toUpperCase();
}

export class CreateProfileDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 200])
  displayName!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 200])
  legalName?: string;

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

  @IsString()
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
