/**
 * V1-SPRINT3-MOBILE-CLAIM-HANDOFF-PLAN (ARENA 2 — Six-Digit Claim Locator Classifier & Validator)
 *
 * Pure TypeScript identifier classifier and validator aligned with ARENA 1's approved
 * `docs/APPROVED-C2C-SIX-DIGIT-REDEMPTION-CONTRACT.md` (`POST /api/v1/agents/cash-to-cash/claim-by-number`
 * and `POST /api/v1/agents/cash-to-cash/claims/recover-by-number`).
 *
 * CRITICAL STRING DISCIPLINE:
 * - Six-digit transfer numbers (`^[0-9]{6}$`, e.g. `"000042"`) are ALWAYS handled as exact
 *   6-character decimal strings.
 * - NEVER coerce to `Number`, NEVER zero-pad shorter numbers (`"42"` is rejected, NOT padded),
 *   NEVER truncate longer numbers, and NEVER pass a 6-digit `transferNumber` into `transferId`.
 */

const SIX_DIGIT_TRANSFER_NUMBER_PATTERN = /^[0-9]{6}$/;

const UUID_IDENTIFIER_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HUMAN_TRANSFER_REFERENCE_PATTERN = /^(?:CASH_TO_CASH[-_]|C2C[-_])[A-Za-z0-9_-]{3,120}$/i;

export type CashToCashClaimIdentifierKind =
  | 'TRANSFER_NUMBER'
  | 'UUID'
  | 'TRANSFER_REFERENCE'
  | 'EMPTY'
  | 'INVALID';

export interface ClassifiedCashToCashClaimIdentifier {
  readonly kind: CashToCashClaimIdentifierKind;
  readonly normalized: string;
}

/**
 * Validates and trims an exact 6-digit transfer number string (`^[0-9]{6}$`), preserving
 * leading zeros (`"000042"`). Rejects shorter (`"42"`), longer (`"0000421"`), or non-digit
 * inputs without numeric coercion or padding.
 */
export function validateSixDigitTransferNumber(raw: string): string | null {
  const trimmed = raw.trim();
  if (!SIX_DIGIT_TRANSFER_NUMBER_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Pure client-side classifier distinguishing an exact 6-digit `transferNumber`, a legacy
 * `transferId` UUID, or a printed receipt `Reference` (`CASH_TO_CASH-...` / `C2C-...`).
 */
export function classifyCashToCashClaimIdentifier(
  raw: string,
): ClassifiedCashToCashClaimIdentifier {
  const normalized = raw.trim();
  if (!normalized) {
    return { kind: 'EMPTY', normalized: '' };
  }
  if (SIX_DIGIT_TRANSFER_NUMBER_PATTERN.test(normalized)) {
    return { kind: 'TRANSFER_NUMBER', normalized };
  }
  if (UUID_IDENTIFIER_PATTERN.test(normalized)) {
    return { kind: 'UUID', normalized };
  }
  if (HUMAN_TRANSFER_REFERENCE_PATTERN.test(normalized)) {
    return { kind: 'TRANSFER_REFERENCE', normalized };
  }
  return { kind: 'INVALID', normalized };
}

export interface MobileClaimHandoffTouchpoint {
  readonly file: string;
  readonly responsibility: string;
  readonly requiredChangeWhenApproved: string;
}

export const CASH_TO_CASH_REFERENCE_HANDOFF_PLAN: readonly MobileClaimHandoffTouchpoint[] = [
  {
    file: 'apps/agent-mobile/src/services/agent-api.ts',
    responsibility: 'Typed claim DTOs, recovery lookup, and error mapping',
    requiredChangeWhenApproved:
      'Integrated senderPhone on POST /agents/cash-to-cash, POST /agents/cash-to-cash/claim-by-number (omitting transferId), POST /agents/cash-to-cash/claims/recover-by-number, and C2C_CLAIM_NOT_AVAILABLE / C2C_LOCATOR_RATE_LIMITED / C2C_RETRY_REQUIRED handling.',
  },
  {
    file: 'apps/agent-mobile/src/navigation/types.ts',
    responsibility: 'CashToCash & CashToCashClaimConfirm route params',
    requiredChangeWhenApproved:
      'Carry senderPhone through initiation and { senderPhone, transferNumber, beneficiaryPhone } in CashToCashClaimConfirm while retaining internal UUID compatibility.',
  },
  {
    file: 'apps/agent-mobile/src/screens/authenticated/cash-to-cash/CashToCashClaimRecipientScreen.tsx',
    responsibility: 'Step 1 beneficiary + senderPhone + 6-digit transferNumber capture',
    requiredChangeWhenApproved:
      'Replace user-facing UUID input with canonical Nigerian senderPhone + exact 6-digit string transferNumber.',
  },
  {
    file: 'apps/agent-mobile/src/screens/authenticated/cash-to-cash/CashToCashClaimConfirmScreen.tsx',
    responsibility: 'Step 2 MFA challenge, secret transferCode, idempotent claim, and recovery',
    requiredChangeWhenApproved:
      'Display senderPhone + transferNumber in SummaryRow, submit to claim-by-number without transferId, and recover via claims/recover-by-number using the original idempotencyKey.',
  },
  {
    file: 'apps/agent-mobile/src/components/AgentReceipt.tsx',
    responsibility: 'Sender & claimant shareable receipts',
    requiredChangeWhenApproved:
      'Surface public 6-digit transferNumber and canonical senderPhone on initiation receipts/share text while strictly excluding secret transferCode.',
  },
] as const;
