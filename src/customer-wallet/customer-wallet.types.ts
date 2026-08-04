import type { CustomerWalletStatus, CustomerWalletType } from './customer-wallet.enums';

export interface CreateCustomerWalletCommand {
  type: CustomerWalletType;
  currency: string;
  status?: CustomerWalletStatus;
  actor: string;
}

export interface UpdateCustomerWalletCommand {
  status: CustomerWalletStatus;
  actor: string;
  version?: number;
}

export interface CreateWalletAliasCommand {
  alias: string;
  actor: string;
}

export interface CustomerWalletView {
  id: string;
  customerId: string;
  type: CustomerWalletType;
  currency: string;
  status: CustomerWalletStatus;
  closedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
