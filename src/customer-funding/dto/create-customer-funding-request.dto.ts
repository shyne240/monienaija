import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class CreateCustomerFundingRequestDto {
  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer in minor units' })
  amountMinor!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be three-letter ISO code' })
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  correlationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;
}
