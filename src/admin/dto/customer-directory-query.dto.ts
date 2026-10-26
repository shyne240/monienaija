import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { CustomerKycLevel, CustomerKycStatus, CustomerStatus, CustomerType } from '../../customer/customer.enums';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CustomerDirectoryQueryDto {
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MaxLength(120)
  search?: string;

  @IsEnum(CustomerStatus)
  @IsOptional()
  status?: CustomerStatus;

  @IsEnum(CustomerType)
  @IsOptional()
  type?: CustomerType;

  @IsEnum(CustomerKycLevel)
  @IsOptional()
  kycLevel?: CustomerKycLevel;

  @IsEnum(CustomerKycStatus)
  @IsOptional()
  kycStatus?: CustomerKycStatus;

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
