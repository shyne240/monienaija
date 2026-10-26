import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength, Validate } from 'class-validator';

import { normalizeCustomerText } from '../../customer/customer-validation';
import { CustomerFieldPolicyConstraint } from '../../customer/customer-validation.constraints';

export class RequestRegistrationOtpDto {
  /** Nigerian phone number accepted by the existing OTP normalization flow. */
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCustomerText(value) : value,
  )
  @MinLength(10)
  @MaxLength(40)
  @Validate(CustomerFieldPolicyConstraint, ['nigerianPhone'])
  phone!: string;
}
