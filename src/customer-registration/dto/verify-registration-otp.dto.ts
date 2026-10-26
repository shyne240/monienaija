import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength, Validate } from 'class-validator';

import { normalizeCustomerText } from '../../customer/customer-validation';
import { CustomerFieldPolicyConstraint } from '../../customer/customer-validation.constraints';

export class VerifyRegistrationOtpDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCustomerText(value) : value,
  )
  @MinLength(10)
  @MaxLength(40)
  @Validate(CustomerFieldPolicyConstraint, ['nigerianPhone'])
  phone!: string;

  /** 6-digit OTP. Never echoed back; never audited ('code' is a redacted sensitive key). */
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit verification code' })
  code!: string;
}
