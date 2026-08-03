import type { WalletStatus } from './wallet.enums';

export interface CreateWalletCommand {
  customerId: string;
  currency: string;
  idempotencyKey: string;
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
