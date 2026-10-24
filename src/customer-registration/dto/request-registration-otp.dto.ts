import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength, Validate } from 'class-validator';

import { CustomerFieldPolicyConstraint } from '../../customer/customer-validation.constraints';

export class RequestRegistrationOtpDto {
  /** Nigerian mobile in any accepted rendering: 08XXXXXXXXX, 8XXXXXXXXX, +2348XXXXXXXXX, 2348XXXXXXXXX. */
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(10)
  @MaxLength(20)
  @Matches(/^[+0-9()\-\s]+$/, { message: 'phone must be a Nigerian phone number' })
  @Validate(CustomerFieldPolicyConstraint, ['nigerianPhone'])
  phone!: string;
}
