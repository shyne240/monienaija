import type { WalletFinancialBoundaryService } from '../../src/wallet/wallet-financial-boundary.service';
/** Explicit stub for legacy manually constructed ledger fixtures; these do not test KYC enforcement. */
export const testWalletFinancialBoundary = {
  requireAccounts: () => Promise.resolve(),
  requireCustomerWallet: () => Promise.resolve(),
} as unknown as WalletFinancialBoundaryService;
