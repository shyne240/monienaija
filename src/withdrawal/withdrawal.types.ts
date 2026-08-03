import type { WithdrawalFailureCode, WithdrawalStatus } from './withdrawal.enums';

export interface CreateWithdrawalCommand {
  walletId: string;
  amountMinor: string | number | bigint;
  currency: string;
  idempotencyKey: string;
  reference?: string;
  narration?: string;
}

export interface WithdrawalView {
  id: string;
  walletId: string;
  journalId: string | null;
  paymentReference: string;
  amountMinor: string;
  currency: string;
  status: WithdrawalStatus;
  idempotencyKey: string;
  reference: string | null;
  narration: string | null;
  failureCode: WithdrawalFailureCode | null;
  failureMessage: string | null;
  failureStatusCode: number | null;
  createdAt: Date;
  completedAt: Date | null;
}
