import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CustomerAgreementType } from '../customer-onboarding.enums';

export class CreateCustomerAgreementDto {
  @IsEnum(CustomerAgreementType)
  type!: CustomerAgreementType;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(40)
  version!: string;

  @IsBoolean()
  isRequired!: boolean;

  @IsBoolean()
  accepted!: boolean;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  acceptedBy?: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
