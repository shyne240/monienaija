import { Transform } from 'class-transformer';
import { IsOptional, IsString, Validate, ValidateIf } from 'class-validator';

import { normalizeCustomerText } from '../customer-validation';
import { CustomerFieldPolicyConstraint } from '../customer-validation.constraints';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? normalizeCustomerText(value) : value;
}

function normalizeCountry(value: unknown): unknown {
  return typeof value === 'string' ? normalizeCustomerText(value).toUpperCase() : value;
}

export class UpdateProfileDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 200])
  displayName?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 200])
  legalName?: string | null;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 100])
  firstName?: string | null;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 100])
  middleName?: string | null;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['name', 100])
  lastName?: string | null;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['dateOfBirth'])
  dateOfBirth?: string | null;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeCountry(value))
  @Validate(CustomerFieldPolicyConstraint, ['isoCountry'])
  nationality?: string | null;
}
