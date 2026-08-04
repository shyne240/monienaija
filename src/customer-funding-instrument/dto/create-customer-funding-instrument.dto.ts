import { Transform } from 'class-transformer';
import { IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { CustomerFundingInstrumentType } from '../customer-funding-instrument.enums';

export class CreateCustomerFundingInstrumentDto {
  @IsEnum(CustomerFundingInstrumentType)
  type!: CustomerFundingInstrumentType;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MinLength(1)
  @MaxLength(160)
  @Matches(/^[a-z0-9][a-z0-9_.:-]{0,159}$/)
  reference!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
