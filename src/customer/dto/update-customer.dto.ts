import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

import { CustomerStatus } from '../customer.enums';

export class UpdateCustomerDto {
  @IsEnum(CustomerStatus)
  status!: CustomerStatus;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
