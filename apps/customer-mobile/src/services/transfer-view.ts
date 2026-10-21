/**
 * Shared adapter from the backend's unified transaction history projection
 * (`GET /customers/me/transactions`) to the `TransactionRow` component's
 * display contract. Kept as a single source of truth so Home and
 * Transactions screens never disagree on label/direction/status rendering.
 *
 * V1-CUSTOMER-07 — the unified endpoint merges five real transaction types
 * drawn from the authoritative double-entry ledger / transfers /
 * funding-requests / cash-to-cash tables:
 *   WALLET_TRANSFER  — Wallet → Wallet
 *   CASH_OUT         — Wallet → Cash Method 1 (agent pays cash out)
 *   CASH_IN          — Cash → Wallet (agent takes cash in)
 *   CASH_TO_CASH     — Cash → Cash (customer is the beneficiary/claimant)
 *   FUNDING          — wallet funding requests
 *
 * This module performs NO financial computation of its own — it is a pure
 * read-model view over values the backend already derived. It never
 * invents a status, direction, or amount; it only chooses how to label and
 * sign what the backend already returned.
 */

import type { BadgeStatus } from '../components/StatusBadge';

export type UnifiedTransactionType = 'WALLET_TRANSFER' | 'FUNDING' | 'CASH_TO_CASH' | 'CASH_IN' | 'CASH_OUT';

export interface UnifiedCounterparty {
  type?: string;
  walletId?: string | null;
  customerId?: string | null;
  displayName?: string | null;
  receivingNumber?: string | null;
  agentId?: string | null;
  beneficiaryPhone?: string | null;
  reference?: string | null;
  channel?: string | null;
}

export interface TransferListItem {
  id: string;
  transferId?: string;
  type: UnifiedTransactionType | string;
  narration: string | null;
  reference: string | null;
  amountMinor: string | number;
  currency: string;
  direction: 'SENT' | 'RECEIVED' | 'INTERNAL' | 'UNKNOWN' | 'CREDIT' | 'DEBIT' | 'PENDING' | 'EXPIRED' | string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  counterparty?: UnifiedCounterparty | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export type TransactionSign = 'IN' | 'OUT' | 'NEUTRAL';

export interface TransactionRowView {
  id: string;
  narration: string;
  reference: string;
  amountMinor: number;
  currency: string;
  sign: TransactionSign;
  status: BadgeStatus;
  createdAt: string;
}

/**
 * Human-readable default label when the backend narration is blank.
 * Never surfaces raw ledger codes, journal ids, or internal workforce
 * identity — counterparty names/phone numbers are only used when the
 * backend already decided it was safe to expose them.
 */
function defaultLabel(item: TransferListItem): string {
  const cp = item.counterparty;
  switch (item.type) {
    case 'WALLET_TRANSFER': {
      const name = cp?.displayName || cp?.receivingNumber;
      if (item.direction === 'SENT') return name ? `Sent to ${name}` : 'Wallet Transfer Sent';
      if (item.direction === 'RECEIVED') return name ? `Received from ${name}` : 'Wallet Transfer Received';
      if (item.direction === 'INTERNAL') return 'Wallet Transfer (Internal)';
      return 'Wallet Transfer';
    }
    case 'FUNDING': {
      if (item.status === 'REJECTED') return 'Wallet Funding (Rejected)';
      if (item.status === 'PENDING') return 'Wallet Funding (Pending)';
      return 'Wallet Funding';
    }
    case 'CASH_TO_CASH': {
      if (item.direction === 'RECEIVED') return 'Cash Transfer Received (Agent)';
      if (item.direction === 'PENDING') return 'Cash Transfer Awaiting Claim';
      if (item.direction === 'EXPIRED') return 'Cash Transfer Expired (Unclaimed)';
      return 'Cash Transfer';
    }
    case 'CASH_IN':
      return 'Cash Deposit via Agent';
    case 'CASH_OUT':
      return 'Cash Withdrawal via Agent';
    default:
      return 'Transaction';
  }
}

/**
 * Maps the backend's per-type status vocabulary onto the shared
 * `StatusBadge` vocabulary. Never maps a non-terminal or unsuccessful
 * state to SUCCESS.
 */
function resolveBadgeStatus(item: TransferListItem): BadgeStatus {
  switch (item.type) {
    case 'WALLET_TRANSFER':
      switch (item.status) {
        case 'COMPLETED':
          return 'SUCCESS';
        case 'FAILED':
          return 'FAILED';
        case 'CANCELLED':
          return 'CANCELLED';
        default:
          // PENDING / PROCESSING / PENDING_RECOVERY / UNKNOWN
          return 'PENDING';
      }
    case 'FUNDING':
      switch (item.status) {
        case 'APPROVED':
          return 'SUCCESS';
        case 'REJECTED':
          return 'FAILED';
        default:
          return 'PENDING';
      }
    case 'CASH_TO_CASH':
      switch (item.status) {
        case 'CLAIMED':
          return 'SUCCESS';
        case 'EXPIRED':
          return 'EXPIRED';
        default:
          // UNCLAIMED
          return 'PENDING';
      }
    case 'CASH_IN':
    case 'CASH_OUT':
      // Only ever surfaced from already-posted ledger journals.
      return 'SUCCESS';
    default:
      return 'PENDING';
  }
}

/**
 * Resolves the correct debit/credit sign for display. A transaction only
 * gets a "+"/incoming or "-"/outgoing sign once money has actually moved
 * for THIS customer; anything still pending, rejected, or expired renders
 * neutral so it can never be mistaken for a completed credit or debit.
 */
function resolveSign(item: TransferListItem): TransactionSign {
  switch (item.type) {
    case 'WALLET_TRANSFER':
      if (item.direction === 'SENT') return 'OUT';
      if (item.direction === 'RECEIVED') return 'IN';
      return 'NEUTRAL';
    case 'FUNDING':
      return item.status === 'APPROVED' ? 'IN' : 'NEUTRAL';
    case 'CASH_TO_CASH':
      return item.direction === 'RECEIVED' ? 'IN' : 'NEUTRAL';
    case 'CASH_IN':
      return 'IN';
    case 'CASH_OUT':
      return 'OUT';
    default:
      return 'NEUTRAL';
  }
}

export function mapTransactionToRow(item: TransferListItem): TransactionRowView {
  return {
    id: item.id ?? item.transferId ?? '',
    narration: item.narration?.trim() || defaultLabel(item),
    reference: item.reference ?? '',
    amountMinor: Number(item.amountMinor),
    currency: item.currency,
    sign: resolveSign(item),
    status: resolveBadgeStatus(item),
    createdAt: item.createdAt,
  };
}

export type SupportTicketCategoryForTransaction =
  | 'TRANSFER'
  | 'FUNDING'
  | 'CASH_TO_CASH'
  | 'CASH_IN'
  | 'CASH_OUT'
  | 'OTHER';

export interface TransactionSupportContext {
  category: SupportTicketCategoryForTransaction;
  subject: string;
  description: string;
  relatedTransferId?: string;
  fundingRequestId?: string;
}

/**
 * V1-CUSTOMER-09 Part G — "reference this transaction without typing an
 * internal identifier". The backend's `SupportTicket` already has
 * `relatedTransferId`/`fundingRequestId` columns (no new backend fields are
 * added here); this maps the unified transaction-history row to that
 * existing model for the two types it directly covers (WALLET_TRANSFER →
 * relatedTransferId, FUNDING → fundingRequestId). CASH_TO_CASH, CASH_IN and
 * CASH_OUT don't have a matching structured column (they are not rows in
 * the `transfers` or `customer_funding_requests` tables), so for those the
 * human-readable reference/date/amount is embedded directly into the
 * prefilled, editable description instead of inventing a new backend field
 * for a single UI convenience.
 */
export function buildSupportContextForTransaction(item: TransferListItem): TransactionSupportContext {
  const row = mapTransactionToRow(item);
  const amountDisplay = (row.amountMinor / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const dateDisplay = new Date(row.createdAt).toLocaleDateString('en-NG');
  const descriptionLines = [
    `I have a question about this transaction:`,
    `- Reference: ${row.reference || 'N/A'}`,
    `- Amount: NGN ${amountDisplay}`,
    `- Date: ${dateDisplay}`,
    '',
    'Details: ',
  ];
  const description = descriptionLines.join('\n');

  switch (item.type) {
    case 'WALLET_TRANSFER':
      return {
        category: 'TRANSFER',
        subject: `Issue with transfer ${row.reference}`.trim(),
        description,
        relatedTransferId: item.id || item.transferId || undefined,
      };
    case 'FUNDING':
      return {
        category: 'FUNDING',
        subject: `Issue with wallet funding ${row.reference}`.trim(),
        description,
        fundingRequestId: item.id || undefined,
      };
    case 'CASH_TO_CASH':
      return {
        category: 'CASH_TO_CASH',
        subject: `Issue with cash-to-cash transfer ${row.reference}`.trim(),
        description,
      };
    case 'CASH_IN':
      return {
        category: 'CASH_IN',
        subject: `Issue with cash deposit ${row.reference}`.trim(),
        description,
      };
    case 'CASH_OUT':
      return {
        category: 'CASH_OUT',
        subject: `Issue with cash withdrawal ${row.reference}`.trim(),
        description,
      };
    default:
      return {
        category: 'OTHER',
        subject: `Issue with transaction ${row.reference}`.trim(),
        description,
      };
  }
}

// Backward-compatible alias (pre V1-CUSTOMER-07 call sites referenced this name).
export const mapTransferToRow = mapTransactionToRow;
