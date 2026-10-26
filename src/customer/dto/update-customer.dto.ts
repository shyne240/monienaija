import { IsEnum } from 'class-validator';

import { CustomerStatus } from '../customer.enums';

export class UpdateCustomerDto {
  @IsEnum(CustomerStatus)
  status!: CustomerStatus;

}
