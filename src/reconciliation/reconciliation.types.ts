import type { CustomerFinancialAccountReconciliationReport } from './customer-financial-account-reconciliation.types';

export enum VerificationStatus {
  PASS = 'PASS',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

export interface ReconciliationCheck {
  name: string;
  status: VerificationStatus;
  message: string;
  details: Record<string, string | number | boolean | null>;
}

export interface ReconciliationReport {
  status: VerificationStatus;
  generatedAt: string;
  checks: ReconciliationCheck[];
  binding: CustomerFinancialAccountReconciliationReport;
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  currency: string;
  accountingUnit: string;
  entryCount: number;
  totalDebitsMinor: string;
  totalCreditsMinor: string;
  balanceMinor: string;
}

export interface TrialBalanceDimension {
  currency: string;
  accountingUnit: string;
  totalDebitsMinor: string;
  totalCreditsMinor: string;
  balanced: boolean;
}

export interface TrialBalanceReport {
  generatedAt: string;
  rows: TrialBalanceRow[];
  dimensions: TrialBalanceDimension[];
  balanced: boolean;
}

export interface BalanceConservationDimension {
  currency: string;
  accountingUnit: string;
  totalDebitsMinor: string;
  totalCreditsMinor: string;
  balanced: boolean;
}

/**
 * F-4C — wallet liability split by financial owner type.
 *
 * Customer wallet liability and Agent e-float are INDEPENDENTLY OWNED balances
 * that share one conservation pool. This dimension reports them separately
 * without implying separate pools: `accountingUnit` is the same for both, and
 * the per-owner totals sum to the combined wallet liability, which in turn is
 * derived from the same ledger lines the conservation check uses.
 */
export interface WalletOwnerPositionDimension {
  ownerType: string;
  currency: string;
  accountingUnit: string;
  walletCount: number;
  balanceMinor: string;
}

export interface JournalIntegrityReport {
  generatedAt: string;
  totalJournals: number;
  invalidJournals: number;
  totalLines: number;
  orphanLines: number;
  balanced: boolean;
}

export interface AccountTypeTotal {
  accountType: 'ASSET' | 'LIABILITY';
  currency: string;
  accountingUnit: string;
  totalBalanceMinor: string;
}

export interface AccountActivitySummary {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  currency: string;
  accountingUnit: string;
  entryCount: number;
  totalDebitsMinor: string;
  totalCreditsMinor: string;
  balanceMinor: string;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
}

export interface FinanceVerificationReport {
  generatedAt: string;
  trialBalance: TrialBalanceReport;
  totalAssets: AccountTypeTotal[];
  totalLiabilities: AccountTypeTotal[];
  journalIntegrity: JournalIntegrityReport;
  balanceConservation: BalanceConservationDimension[];
  /** F-4C: wallet liability split by owner type within the shared pool. */
  walletOwnerPositions: WalletOwnerPositionDimension[];
  accountActivity: AccountActivitySummary[];
}
