import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Validate, ValidateIf } from 'class-validator';

import { normalizeCustomerText } from '../customer-validation';
import { CustomerFieldPolicyConstraint } from '../customer-validation.constraints';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? normalizeCustomerText(value) : value;
}

export class UpdateContactMethodDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['freeText', 255])
  value?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCustomerText(value).toUpperCase() : value,
  )
  @Validate(CustomerFieldPolicyConstraint, ['isoAlpha2'])
  phoneCountry?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  isPrimary?: boolean;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @Validate(CustomerFieldPolicyConstraint, ['freeText', 128])
  verificationToken?: string;
}
