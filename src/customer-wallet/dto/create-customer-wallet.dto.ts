import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { CustomerWalletStatus, CustomerWalletType } from '../customer-wallet.enums';

/**
 * V1 customer-facing wallet creation is restricted to individual customers'
 * PRIMARY NGN wallet. The underlying CustomerWalletType/service model stays
 * generic for future phases; only this HTTP boundary narrows the scope.
 */
export class CreateCustomerWalletDto {
  @IsEnum(CustomerWalletType)
  @IsIn([CustomerWalletType.PRIMARY], {
    message: 'V1 supports PRIMARY customer wallets only',
  })
  type!: CustomerWalletType;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^NGN$/, { message: 'V1 customer wallets are NGN denominated only' })
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
