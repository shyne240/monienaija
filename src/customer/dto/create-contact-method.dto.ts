import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Validate } from 'class-validator';

import { normalizeCustomerText } from '../customer-validation';
import { CustomerFieldPolicyConstraint } from '../customer-validation.constraints';
import { ContactMethodType } from '../customer.enums';

export class CreateContactMethodDto {
  @IsEnum(ContactMethodType)
  type!: ContactMethodType;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCustomerText(value) : value,
  )
  @Validate(CustomerFieldPolicyConstraint, ['contactValue'])
  value!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCustomerText(value).toUpperCase() : value,
  )
  @Validate(CustomerFieldPolicyConstraint, ['isoAlpha2'])
  phoneCountry?: string;

  @IsBoolean()
  isPrimary!: boolean;
}
