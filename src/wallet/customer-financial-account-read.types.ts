import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { CustomerFinancialAccountBindingState } from './customer-financial-account-binding.enums';

export type CustomerFinancialAccountReadState =
  | 'ACTIVE'
  | 'PENDING'
  | 'SUSPENDED'
  | 'REPAIR_REQUIRED'
  | 'CLOSED'
  | 'MISSING_BINDING'
  | 'STALE_BINDING'
  | 'LEDGER_UNAVAILABLE';

export interface CustomerFinancialAccountReadCommand {
  customerId: string;
  principal: AuthorizationPrincipal;
}

export interface CustomerFinancialAccountView {
  bindingId: string | null;
  customerId: string;
  customerWalletId: string | null;
  walletAccountId: string | null;
  ledgerAccountId: string | null;
  bindingState: CustomerFinancialAccountBindingState | null;
  readState: CustomerFinancialAccountReadState;
  currency: string | null;
  accountingUnit: string | null;
  balanceMinor: string | null;
  warnings: string[];
}

export interface CustomerFinancialAccountReadModel {
  customerId: string;
  generatedAt: string;
  accounts: CustomerFinancialAccountView[];
  warnings: string[];
}
