import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

import {
  // Centralized sanitation envelope derived from the PIN security
  // policy bounds; the authoritative length rule is the configured
  // policy enforced server-side (transaction-pin-policy.ts).
  PIN_INPUT_PATTERN,
} from '../transaction-pin-policy';

/**
 * Initial transaction PIN setup. The PIN travels only inside the
 * authenticated request body and is hashed server-side immediately; it is
 * never stored, returned, or logged.
 */
export class CreateTransactionPinDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(PIN_INPUT_PATTERN)
  pin!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(160)
  actor!: string;
}
