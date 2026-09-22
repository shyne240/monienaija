import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// Sanitation envelope only — NOT the PIN length rule. The authoritative
// length policy is centralized (transaction-pin-policy.ts) and enforced
// server-side inside CustomerTransactionPinService.verifyTransactionPin.
import { PIN_INPUT_PATTERN } from '../../customer-authentication/transaction-pin-policy';

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
 * Customer-initiated deposit/withdrawal request. The target WalletAccount is
 * resolved server-side through the authenticated customer's ACTIVE binding;
 * the client never supplies a wallet identifier for these operations.
 */
export class CreateCustomerMoneyMovementDto {
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
   * Step-up transaction PIN. Required for withdrawals (this DTO is shared
   * with deposits, which do not consume it); the withdrawal path enforces
   * presence and the centralized length policy server-side.
   */
  @IsString()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimString(value))
  @Matches(PIN_INPUT_PATTERN)
  transactionPin?: string;

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
