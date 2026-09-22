import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CustomerStatus, CustomerType } from '../customer.enums';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateCustomerDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  reference!: string;

  @IsEnum(CustomerType)
  type!: CustomerType;

  @IsEnum(CustomerStatus)
  @IsOptional()
  status?: CustomerStatus;

  /**
   * Optional primary Nigerian phone (local 0NN…, 234…, or +234… forms are all
   * accepted). Stored canonically through the CustomerContactMethod
   * architecture; never treated as the customer registry reference.
   */
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(8)
  @MaxLength(32)
  phone?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
