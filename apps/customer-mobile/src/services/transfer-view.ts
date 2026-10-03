/**
 * Shared adapter from the backend's `/customers/me/transfers` (and
 * `/customers/me/transactions`) projection to the `TransactionRow` component's
 * display contract. Kept as a single source of truth so Home and Transactions
 * screens never disagree on direction/status labelling.
 */

export interface TransferListItem {
  id: string;
  transferId: string;
  narration: string | null;
  reference: string | null;
  amountMinor: string | number;
  currency: string;
  direction: 'SENT' | 'RECEIVED' | 'INTERNAL' | 'UNKNOWN';
  status: 'PENDING' | 'PROCESSING' | 'PENDING_RECOVERY' | 'UNKNOWN' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  createdAt: string;
}

export interface TransactionRowView {
  id: string;
  narration: string;
  reference: string;
  amountMinor: number;
  currency: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REVERSED' | 'CANCELLED';
  createdAt: string;
}

export function mapTransferToRow(item: TransferListItem): TransactionRowView {
  const type: TransactionRowView['type'] = item.direction === 'RECEIVED' ? 'TRANSFER_IN' : 'TRANSFER_OUT';

  let status: TransactionRowView['status'];
  switch (item.status) {
    case 'COMPLETED':
      status = 'SUCCESS';
      break;
    case 'FAILED':
      status = 'FAILED';
      break;
    case 'CANCELLED':
      status = 'CANCELLED';
      break;
    default:
      status = 'PENDING';
  }

  return {
    id: item.transferId ?? item.id,
    narration: item.narration ?? '',
    reference: item.reference ?? '',
    amountMinor: Number(item.amountMinor),
    currency: item.currency,
    type,
    status,
    createdAt: item.createdAt,
  };
}
