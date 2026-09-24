import type { TransferDirection, TransferFailureCode, TransferStatus } from './transfer.enums';

export interface CreateTransferCommand {
  sourceWalletId: string;
  destinationWalletId: string;
  amountMinor: string | number | bigint;
  currency: string;
  idempotencyKey: string;
  reference?: string;
  narration?: string;
}

export interface TransferView {
  id: string;
  sourceWalletId: string;
  destinationWalletId: string;
  journalId: string | null;
  paymentReference: string | null;
  journalReference: string | null;
  amountMinor: string;
  currency: string;
  status: TransferStatus;
  idempotencyKey: string;
  reference: string | null;
  narration: string | null;
  failureCode: TransferFailureCode | null;
  failureMessage: string | null;
  failureStatusCode: number | null;
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * A5T13 — item projection for the GLOBAL operational transfer listing.
 *
 * Deliberately `TransferView` MINUS `idempotencyKey`. The single-transfer read
 * (`GET /transfers/:transferId`) exposes the idempotency key to a caller who
 * already holds the transfer id, but an idempotency key is a client-supplied
 * replay credential, and enumerating every key in a global listing is a
 * materially different exposure. This is the smallest safe projection: no
 * other operational field is removed, and `requestHash`, `policyInputHash`
 * and the policy/binding internals were never in `TransferView` at all.
 */
export type GlobalTransferListItemView = Omit<TransferView, 'idempotencyKey'>;

/**
 * A5T13 paginated global transfer listing. Mirrors the repository's existing
 * pagination envelope (`WalletTransactionHistoryView`).
 */
export interface GlobalTransferListView {
  items: GlobalTransferListItemView[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

export interface WalletTransactionView {
  transferId: string;
  direction: TransferDirection;
  counterpartyWalletId: string;
  amountMinor: string;
  currency: string;
  status: TransferStatus;
  journalId: string | null;
  reference: string | null;
  narration: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface WalletTransactionHistoryView {
  items: WalletTransactionView[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

export interface TransferFailure {
  code: TransferFailureCode;
  statusCode: number;
  message: string;
}

export interface TransferTransactionResult {
  transferId?: string;
  failure?: TransferFailure;
}
