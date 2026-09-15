import type { WalletOwnershipBinding } from '../wallet/wallet-ownership';
import type { WithdrawalFailureCode, WithdrawalStatus } from './withdrawal.enums';

export interface CreateWithdrawalCommand {
  walletId: string;
  /**
   * Who the withdrawal is created for. Required so that a caller-supplied `walletId` can never on
   * its own authorise a withdrawal from a wallet that belongs to another customer. Always derived
   * from the authenticated principal by the HTTP layer, never from request input.
   */
  ownership: WalletOwnershipBinding;
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
