import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

import { CustomerFundingInstrumentStatus } from '../customer-funding-instrument.enums';

export class UpdateCustomerFundingInstrumentDto {
  @IsEnum(CustomerFundingInstrumentStatus)
  status!: CustomerFundingInstrumentStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  version?: number;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
