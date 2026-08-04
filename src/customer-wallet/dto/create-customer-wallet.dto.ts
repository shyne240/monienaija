import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { CustomerWalletStatus, CustomerWalletType } from '../customer-wallet.enums';

export class CreateCustomerWalletDto {
  @IsEnum(CustomerWalletType)
  type!: CustomerWalletType;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @IsEnum(CustomerWalletStatus)
  @IsOptional()
  status: CustomerWalletStatus = CustomerWalletStatus.PENDING;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
