import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

import {
  // Centralized sanitation envelope derived from the PIN security
  // policy bounds; the authoritative length rule is the configured
  // policy enforced server-side (transaction-pin-policy.ts).
  PIN_INPUT_PATTERN,
} from '../transaction-pin-policy';

/**
 * Transaction PIN reset. Recovery authorization reuses the customer's
 * existing password credential through the established authentication
 * execution path; knowing the customer ID alone never authorizes a reset.
 * Neither the password nor the new PIN is stored, returned, or logged.
 */
export class ResetTransactionPinDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(PIN_INPUT_PATTERN)
  newPin!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
