import type { DepositFailureCode, DepositStatus } from './deposit.enums';

export interface CreateDepositCommand {
  walletId: string;
  amountMinor: string | number | bigint;
  currency: string;
  idempotencyKey: string;
  reference?: string;
  narration?: string;
}

export interface DepositView {
  id: string;
  walletId: string;
  journalId: string | null;
  paymentReference: string;
  amountMinor: string;
  currency: string;
  status: DepositStatus;
  idempotencyKey: string;
  reference: string | null;
  narration: string | null;
  failureCode: DepositFailureCode | null;
  failureMessage: string | null;
  failureStatusCode: number | null;
  createdAt: Date;
  completedAt: Date | null;
}
