import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { CustomerStatus, CustomerType } from '../customer.enums';

export class CustomerQueryDto {
  @IsEnum(CustomerStatus)
  @IsOptional()
  status?: CustomerStatus;

  @IsEnum(CustomerType)
  @IsOptional()
  type?: CustomerType;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  page?: number;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number;
}
