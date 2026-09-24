import type { WalletStatus } from './wallet.enums';

/**
 * F-1 — explicit ledger-account specification for a wallet.
 *
 * Supplied only by owners whose general-ledger classification is not the
 * historical customer default (today: Agent e-float, whose classification is
 * Finance-owned configuration). Omitted for Customers, whose behaviour is
 * unchanged.
 */
export interface WalletLedgerAccountSpec {
  code: string;
  name: string;
  accountType: string;
  normalBalance: string;
  accountingUnit: string;
  allowNegativeBalance: boolean;
}

export interface CreateWalletCommand {
  /** Owner reference. A Customer id unless `ownerType` says otherwise. */
  customerId: string;
  currency: string;
  idempotencyKey: string;
  /** Defaults to CUSTOMER, preserving pre-F-1 behaviour exactly. */
  ownerType?: string;
  /** Defaults to the historical customer wallet classification. */
  ledgerAccountSpec?: WalletLedgerAccountSpec;
}

export interface WalletView {
  id: string;
  customerId: string;
  currency: string;
  status: WalletStatus;
  ledgerAccountId: string;
  balanceMinor: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletBalanceView {
  walletId: string;
  currency: string;
  balanceMinor: string;
}
