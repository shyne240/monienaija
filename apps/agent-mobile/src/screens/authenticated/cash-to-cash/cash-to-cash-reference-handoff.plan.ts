/**
 * V1-SPRINT3-MOBILE-CLAIM-HANDOFF-PLAN (ARENA 2 — Isolated Contract Review & Typed Plan)
 *
 * Zero-network, pure TypeScript contract review and integration plan for the Cash-to-Cash
 * reference-versus-UUID handoff currently under ARENA 1 investigation.
 *
 * IMPORTANT BOUNDARIES:
 * - Does NOT guess or call any unverified backend endpoint.
 * - Does NOT alter the live `POST /api/v1/agents/cash-to-cash/claim` or
 *   `GET /api/v1/agents/cash-to-cash/claims/:transferId` contracts.
 *
 * VERIFIED SPRINT 3 HANDOFF GAP:
 * 1. Sender Agent initiates Cash-to-Cash (`POST /api/v1/agents/cash-to-cash`), receiving both:
 *    - `transferId` (UUID — internal primary key)
 *    - `reference` (`CASH_TO_CASH-<idempotencyKey>` or `C2C-...` — human-shareable reference)
 * 2. `AgentReceipt` (`receiptFromCashToCashResult`) intentionally omits raw internal UUIDs from
 *    customer-facing shared receipts (`shareText` / receipt rows), surfacing `Reference` instead.
 * 3. Claiming Agent (`CashToCashClaimRecipientScreen` -> `CashToCashClaimConfirmScreen`) must
 *    currently submit `transferId` (`@IsUUID()` in `AgentCashToCashClaimDto`) to
 *    `POST /api/v1/agents/cash-to-cash/claim` and `GET /api/v1/agents/cash-to-cash/claims/:transferId`.
 */

const UUID_IDENTIFIER_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HUMAN_TRANSFER_REFERENCE_PATTERN = /^(?:CASH_TO_CASH[-_]|C2C[-_])[A-Za-z0-9_-]{3,120}$/i;

export type CashToCashClaimIdentifierKind =
  | 'UUID'
  | 'TRANSFER_REFERENCE'
  | 'EMPTY'
  | 'INVALID';

export interface ClassifiedCashToCashClaimIdentifier {
  readonly kind: CashToCashClaimIdentifierKind;
  readonly normalized: string;
}

/**
 * Pure client-side classifier distinguishing a canonical `transferId` UUID from a receipt
 * `Reference` (`CASH_TO_CASH-...` / `C2C-...`) so `CashToCashClaimRecipientScreen` can guide
 * the Agent accurately without calling nonexistent lookup routes.
 */
export function classifyCashToCashClaimIdentifier(
  raw: string,
): ClassifiedCashToCashClaimIdentifier {
  const normalized = raw.trim();
  if (!normalized) {
    return { kind: 'EMPTY', normalized: '' };
  }
  if (UUID_IDENTIFIER_PATTERN.test(normalized)) {
    return { kind: 'UUID', normalized };
  }
  if (HUMAN_TRANSFER_REFERENCE_PATTERN.test(normalized)) {
    return { kind: 'TRANSFER_REFERENCE', normalized };
  }
  return { kind: 'INVALID', normalized };
}

/**
 * Backend contract shapes ARENA 2 is prepared to wire once ARENA 1 finalizes the approved API:
 *
 * - `DIRECT_CLAIM_BY_REFERENCE`: `POST /api/v1/agents/cash-to-cash/claim` and recovery lookup
 *   accept `transferReference` (mutually exclusive with or preferred over `transferId`) so
 *   no pre-claim metadata leak occurs prior to transferCode + beneficiary OTP verification.
 * - `PRE_CLAIM_LOOKUP_BY_REFERENCE`: Dedicated authenticated Agent lookup resolves
 *   `(reference, beneficiaryPhone)` -> `{ transferId, status, expiresAt }` (without exposing
 *   `principalMinor` or sender PII before secret code verification, per V1-AGENT-07).
 */
export type PendingArena1HandoffStrategy =
  | 'DIRECT_CLAIM_BY_REFERENCE'
  | 'PRE_CLAIM_LOOKUP_BY_REFERENCE';

export interface PendingArena1DirectReferenceClaimExtension {
  /** Human-readable receipt reference (`CASH_TO_CASH-...`), replacing raw UUID entry. */
  readonly transferReference?: string;
}

export interface PendingArena1ReferenceResolutionView {
  readonly transferId: string;
  readonly reference: string;
  readonly status: 'UNCLAIMED' | 'CLAIMED' | 'EXPIRED';
  readonly expiresAt: string;
}

export interface MobileClaimHandoffTouchpoint {
  readonly file: string;
  readonly responsibility: string;
  readonly requiredChangeWhenApproved: string;
}

/**
 * Authoritative integration checklist for Agent Mobile once ARENA 1 lands the approved contract.
 */
export const CASH_TO_CASH_REFERENCE_HANDOFF_PLAN: readonly MobileClaimHandoffTouchpoint[] = [
  {
    file: 'apps/agent-mobile/src/services/agent-api.ts',
    responsibility: 'Typed claim DTOs, recovery lookup, and error mapping',
    requiredChangeWhenApproved:
      'Extend AgentCashToCashClaimRequest with optional transferReference (or add approved reference resolver) and support reference-keyed post-submit recovery alongside getAgentCashToCashClaim.',
  },
  {
    file: 'apps/agent-mobile/src/navigation/types.ts',
    responsibility: 'CashToCashClaimConfirm route params',
    requiredChangeWhenApproved:
      'Carry { transferId?: string; transferReference?: string; displayIdentifier: string } in RootStackParamList["CashToCashClaimConfirm"] without passing transferCode or OTP.',
  },
  {
    file: 'apps/agent-mobile/src/screens/authenticated/cash-to-cash/CashToCashClaimRecipientScreen.tsx',
    responsibility: 'Step 1 beneficiary + transfer identifier capture',
    requiredChangeWhenApproved:
      'Enable TRANSFER_REFERENCE classification in handleVerify/handleProceed so Agents can enter the printed receipt reference (CASH_TO_CASH-...) directly while retaining UUID backward compatibility.',
  },
  {
    file: 'apps/agent-mobile/src/screens/authenticated/cash-to-cash/CashToCashClaimConfirmScreen.tsx',
    responsibility: 'Step 2 MFA challenge, secret transferCode, idempotent claim, and recovery',
    requiredChangeWhenApproved:
      'Display transferReference in SummaryRow, forward transferReference/transferId in claimMutation, and run pre-mount / post-error recovery against the approved recovery identifier.',
  },
  {
    file: 'apps/agent-mobile/src/components/AgentReceipt.tsx',
    responsibility: 'Sender & claimant shareable receipts',
    requiredChangeWhenApproved:
      'Highlight the claimable Transfer Reference prominently on sender Cash-to-Cash receipts as the single handoff identifier alongside the out-of-band secret transferCode.',
  },
] as const;
