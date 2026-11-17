import { ApiClient } from './api-client';

/**
 * ARENA 3D — customer banking: the real bank account a transfer can be sent to.
 *
 * This replaces nothing; it adds the one thing the "Add money" screen was missing. Before this, the
 * screen could only show the internal MonieNaija receiving number, which is not a bank account and
 * cannot be credited by a bank transfer.
 *
 * The state vocabulary is the server's, and several members mean "there is no account number":
 * a customer must never be shown a NUBAN that the provider never issued. `accountNumber` is therefore
 * nullable in the type, so no screen can render it without handling the absent case.
 */

export type ReceivingAccountState =
  | 'PROVISIONED'
  | 'PENDING'
  | 'UNKNOWN'
  | 'NOT_PROVISIONED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INSTITUTION_UNAVAILABLE';

export interface ReceivingAccount {
  state: ReceivingAccountState;
  accountNumber: string | null;
  bankName: string | null;
  accountName: string | null;
  /** The provider's own reason when it declined; safe to show, contains no credentials. */
  providerMessage?: string | null;
  /** True when an earlier attempt is still unresolved. Provisioning must NOT be retried then. */
  unknownPending?: boolean;
}

export type DepositState =
  | 'FLOAT_CREDITED'
  | 'VERIFIED_AWAITING_FLOAT_CREDIT'
  | 'CONFIRMING'
  | 'REJECTED';

export interface Deposit {
  id: string;
  reference: string;
  amountMinor: string;
  currency: string;
  receivedAt: string;
  state: DepositState;
}

export type TransferState =
  | 'PENDING'
  | 'SUBMITTING'
  | 'UNKNOWN'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'REVERSED';

export interface TransferStatus {
  operationReference: string;
  state: TransferState;
  amountMinor: string;
  currency: string;
  destinationAccountNumber: string | null;
  destinationBankName: string | null;
  /** Present only once the provider gave an authoritative outcome. */
  providerReference: string | null;
  failureCode: string | null;
  createdAt: string;
}

export const BankingApi = {
  /** The customer's bank-transfer receiving account, or the honest reason there is none. */
  receivingAccount: (walletId: string) =>
    ApiClient.get<ReceivingAccount>(
      `/customers/me/banking/virtual-account?walletId=${encodeURIComponent(walletId)}`,
    ),

  /**
   * Requests an account.
   *
   * If a previous attempt is `UNKNOWN`, the server returns that state instead of submitting again —
   * a second submission could create a second real account. The screen must show that as
   * "still confirming" and must not offer a retry button.
   */
  requestReceivingAccount: (walletId: string) =>
    ApiClient.post<ReceivingAccount>(
      `/customers/me/banking/virtual-account?walletId=${encodeURIComponent(walletId)}`,
      {},
    ),

  /** Verified money that arrived in the receiving account. */
  deposits: (walletId: string) =>
    ApiClient.get<Deposit[]>(
      `/customers/me/banking/deposits?walletId=${encodeURIComponent(walletId)}`,
    ),

  /**
   * Status of an outbound transfer.
   *
   * `UNKNOWN` is a real answer, not an error: it means we submitted and have not yet obtained an
   * authoritative outcome. The customer must not be told to try again.
   */
  transferStatus: (operationReference: string) =>
    ApiClient.get<TransferStatus>(
      `/customers/me/banking/transfers/${encodeURIComponent(operationReference)}`,
    ),
};
