/**
 * Finance → Transaction History detail-link adapter.
 *
 * Implements the contract published in
 * `docs/transaction-history/FINANCE-DETAIL-LINK-CONTRACT.md` (PR #23):
 *
 * - The link is `#transaction-history/<TYPE>/<UUID>`.
 * - The UUID is the **business transaction key**, never a ledger line, event or arbitrary journal.
 * - Supported types are `WALLET_TRANSFER`, `CASH_IN`, `CASH_OUT`, `CASH_TO_CASH` and
 *   `BANK_TO_WALLET`.
 * - Cash-in/cash-out use the **original posted canonical-service journal ID**; a reversal journal
 *   ID is never a substitute.
 * - A product with no supported history mapping reports that the link is unavailable instead of
 *   guessing a type from a reference prefix.
 *
 * This module is the Finance side of the contract. When PR #23's
 * `transactionDetailLink`/`TransactionHistoryScreen` are merged, both produce the same hash and the
 * shell opens the unified detail drawer. The mapping rules are unit-tested so the adapter cannot
 * silently start linking reversal journals or unsupported products.
 */

export type UnifiedTransactionHistoryType =
  | 'WALLET_TRANSFER'
  | 'CASH_IN'
  | 'CASH_OUT'
  | 'CASH_TO_CASH'
  | 'BANK_TO_WALLET';

export interface UnifiedTransactionTarget {
  type: UnifiedTransactionHistoryType;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TransactionHistoryLinkResolution =
  | { available: true; target: UnifiedTransactionTarget }
  | { available: false; reason: string };

export interface JournalSourceForLink {
  type: string;
  id: string;
}

export interface JournalForLink {
  id: string;
  reversal: { kind: 'NORMAL' | 'IS_REVERSAL' | 'REVERSED' };
}

/** `#transaction-history/<TYPE>/<UUID>` — the published contract link. */
export function transactionHistoryLink(type: string, id: string): string {
  return `#transaction-history/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}

export function resolveTransactionHistoryLink(
  source: JournalSourceForLink | null | undefined,
  journal: JournalForLink | null | undefined,
): TransactionHistoryLinkResolution {
  if (!source) {
    return { available: false, reason: 'No source transaction is linked to this journal.' };
  }
  switch (source.type) {
    case 'TRANSFER':
      return { available: true, target: { type: 'WALLET_TRANSFER', id: source.id } };
    case 'CASH_TO_CASH':
      // Claim/expiry investigations still link the parent cash-to-cash transaction.
      return { available: true, target: { type: 'CASH_TO_CASH', id: source.id } };
    case 'BANK_TO_WALLET': {
      // The server only emits this type when persisted evidence produced the immutable bank-intake
      // UUID. Refuse anything that is not a UUID, or a journal that is itself a reversal, rather than
      // building a link that cannot resolve to the same business record.
      if (!UUID.test(source.id)) {
        return {
          available: false,
          reason:
            'No persisted bank-intake identifier was resolved for this journal, so Bank to Wallet cannot be linked.',
        };
      }
      if (journal && journal.reversal.kind !== 'NORMAL') {
        return {
          available: false,
          reason:
            'This record is a reversal journal. The contract links the original business transaction, never a reversal.',
        };
      }
      return { available: true, target: { type: 'BANK_TO_WALLET', id: source.id } };
    }
    case 'DEPOSIT':
    case 'WITHDRAWAL': {
      if (!journal) {
        return {
          available: false,
          reason: 'The canonical cash-in/out journal could not be read, so no business key exists.',
        };
      }
      if (journal.reversal.kind === 'IS_REVERSAL') {
        return {
          available: false,
          reason:
            'This record is a reversal journal. The contract links cash-in/out by the original posted journal ID, never the reversal.',
        };
      }
      return {
        available: true,
        target: {
          type: source.type === 'DEPOSIT' ? 'CASH_IN' : 'CASH_OUT',
          id: journal.id,
        },
      };
    }
    default:
      return {
        available: false,
        reason: `Unified Transaction History has no mapping for ${source.type
          .replace(/_/g, ' ')
          .toLowerCase()} yet.`,
      };
  }
}
