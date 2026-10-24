import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength, Validate } from 'class-validator';

import { CustomerFieldPolicyConstraint } from '../../customer/customer-validation.constraints';

export class VerifyRegistrationOtpDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(10)
  @MaxLength(20)
  @Matches(/^[+0-9()\-\s]+$/, { message: 'phone must be a Nigerian phone number' })
  @Validate(CustomerFieldPolicyConstraint, ['nigerianPhone'])
  phone!: string;

  /** 6-digit OTP. Never echoed back; never audited ('code' is a redacted sensitive key). */
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit verification code' })
  code!: string;
}
