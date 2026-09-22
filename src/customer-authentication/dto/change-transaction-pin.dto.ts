import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

import {
  // Centralized sanitation envelope derived from the PIN security
  // policy bounds; the authoritative length rule is the configured
  // policy enforced server-side (transaction-pin-policy.ts).
  PIN_INPUT_PATTERN,
} from '../transaction-pin-policy';

/**
 * Transaction PIN change. The current PIN is verified first (wrong entries
 * count toward PIN lockout); neither value is ever stored or returned.
 */
export class ChangeTransactionPinDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(PIN_INPUT_PATTERN)
  currentPin!: string;

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
