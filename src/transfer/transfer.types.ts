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
