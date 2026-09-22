import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

// Sanitation envelope only — NOT the PIN length rule. The authoritative
// length policy is centralized (transaction-pin-policy.ts) and enforced
// server-side inside CustomerTransactionPinService.verifyTransactionPin.
import { PIN_INPUT_PATTERN } from '../../customer-authentication/transaction-pin-policy';

import { CustomerTransferDestinationType } from '../customer-financial-operations.types';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeMinorUnitInput(value: unknown): unknown {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }

  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Explicit, unambiguous transfer destination. A raw string is never guessed:
 * `type` declares whether `value` is a WalletAccount UUID, a 10-digit
 * MonieNaija receiving number, or a Nigerian phone number. Server-side
 * semantics are enforced per type.
 */
export class CreateCustomerTransferDestinationDto {
  @IsEnum(CustomerTransferDestinationType)
  type!: CustomerTransferDestinationType;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MinLength(1)
  @MaxLength(64)
  value!: string;
}

/**
 * Customer-initiated wallet-to-wallet transfer. The source WalletAccount is
 * never client-supplied: the server resolves it through the authenticated
 * customer's ACTIVE CustomerWallet financial binding. The destination is
 * either the legacy raw WalletAccount identifier (`destinationWalletId`) or
 * the explicit discriminated union (`destination`), never both.
 */
export class CreateCustomerTransferDto {
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  destinationWalletId?: string;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCustomerTransferDestinationDto)
  destination?: CreateCustomerTransferDestinationDto;

  @Transform(({ value }: { value: unknown }) => normalizeMinorUnitInput(value))
  @IsString()
  @Matches(/^[1-9]\d*$/)
  amountMinor!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  /**
   * Step-up transaction PIN. Verified server-side (with the centralized
   * length policy) before money movement; never stored, logged, or returned.
   */
  @IsString()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @Matches(PIN_INPUT_PATTERN)
  transactionPin!: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(255)
  reference?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @MaxLength(255)
  narration?: string;
}
