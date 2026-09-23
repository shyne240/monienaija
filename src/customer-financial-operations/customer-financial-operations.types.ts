import type { AuthorizationPrincipal } from '../authorization/authorization.types';

/** Explicit, unambiguous transfer destination mechanisms for customer transfers. */
export enum CustomerTransferDestinationType {
  /** Raw WalletAccount UUID (legacy/direct; still server-validated + not-selon). */
  WALLET_ACCOUNT = 'WALLET_ACCOUNT',
  /** System-issued 10-digit MonieNaija receiving number. */
  MONIENAIJA_NUMBER = 'MONIENAIJA_NUMBER',
  /** Nigerian phone in any accepted representation. */
  PHONE = 'PHONE',
}

export interface CustomerTransferDestination {
  type: CustomerTransferDestinationType;
  value: string;
}

export interface CustomerTransferCommand {
  customerId: string;
  /**
   * Authenticated CUSTOMER principal from the runtime access guard. The A5T03
   * gate re-authorizes this principal (A2, SELF scope) before money movement;
   * a command without a principal is rejected as 401 before anything else.
   */
  principal: AuthorizationPrincipal;
  /** Legacy direct-WalletAccount destination; mutually exclusive with `destination`. */
  destinationWalletId?: string;
  /** Discriminated destination; mutually exclusive with `destinationWalletId`. */
  destination?: CustomerTransferDestination;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  /**
   * Step-up authorization factor, verified BEFORE any money movement. Never
   * persisted, logged, or forwarded downstream.
   */
  transactionPin: string;
  reference?: string;
  narration?: string;
}

export interface CustomerMoneyMovementCommand {
  customerId: string;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  /** Step-up PIN; required for withdrawals, unused by deposits. */
  transactionPin?: string;
  reference?: string;
  narration?: string;
}

export interface CustomerTransactionsQuery {
  customerId: string;
  customerWalletId: string;
  page?: number;
  limit?: number;
}
