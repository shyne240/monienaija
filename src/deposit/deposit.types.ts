import type { WalletOwnershipBinding } from '../wallet/wallet-ownership';
import type { DepositFailureCode, DepositStatus } from './deposit.enums';

export interface CreateDepositCommand {
  walletId: string;
  /**
   * Who the deposit is created for. Required so that a caller-supplied `walletId` can never on its
   * own authorise a deposit into a wallet that belongs to another customer. Always derived from the
   * authenticated principal by the HTTP layer, never from request input.
   */
  ownership: WalletOwnershipBinding;
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
