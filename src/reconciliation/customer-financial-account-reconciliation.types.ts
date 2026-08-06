import type { VerificationStatus } from './reconciliation.types';

export enum CustomerFinancialAccountDiscrepancyType {
  DUPLICATE_ACTIVE_BINDING = 'DUPLICATE_ACTIVE_BINDING',
  MISSING_CUSTOMER = 'MISSING_CUSTOMER',
  MISSING_CUSTOMER_WALLET = 'MISSING_CUSTOMER_WALLET',
  MISSING_WALLET_ACCOUNT = 'MISSING_WALLET_ACCOUNT',
  MISSING_LEDGER_ACCOUNT = 'MISSING_LEDGER_ACCOUNT',
  ORPHANED_BINDING = 'ORPHANED_BINDING',
  ORPHANED_CUSTOMER_WALLET = 'ORPHANED_CUSTOMER_WALLET',
  MISSING_ACTIVE_BINDING = 'MISSING_ACTIVE_BINDING',
  UNBOUND_FINANCIAL_WALLET = 'UNBOUND_FINANCIAL_WALLET',
  CUSTOMER_OWNERSHIP_MISMATCH = 'CUSTOMER_OWNERSHIP_MISMATCH',
  ACCOUNT_OWNERSHIP_MISMATCH = 'ACCOUNT_OWNERSHIP_MISMATCH',
  WALLET_LEDGER_RELATIONSHIP_MISMATCH = 'WALLET_LEDGER_RELATIONSHIP_MISMATCH',
  STALE_BINDING = 'STALE_BINDING',
  LIFECYCLE_MISMATCH = 'LIFECYCLE_MISMATCH',
  CURRENCY_MISMATCH = 'CURRENCY_MISMATCH',
  ACCOUNTING_UNIT_MISMATCH = 'ACCOUNTING_UNIT_MISMATCH',
  ACCOUNT_TYPE_MISMATCH = 'ACCOUNT_TYPE_MISMATCH',
  NORMAL_BALANCE_MISMATCH = 'NORMAL_BALANCE_MISMATCH',
  NEGATIVE_BALANCE_ALLOWED = 'NEGATIVE_BALANCE_ALLOWED',
  INACTIVE_LEDGER_ACCOUNT = 'INACTIVE_LEDGER_ACCOUNT',
  QUERY_UNAVAILABLE = 'QUERY_UNAVAILABLE',
}

export type CustomerFinancialAccountDiscrepancyOwner =
  | 'CUSTOMER_ENGINEERING'
  | 'WALLET'
  | 'LEDGER'
  | 'FINANCE'
  | 'RECONCILIATION'
  | 'OPERATIONS';

export type CustomerFinancialAccountRecoveryState =
  | 'NO_AUTOMATIC_REPAIR'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'A3T08_HANDOFF';

export interface CustomerFinancialAccountDiscrepancy {
  key: string;
  type: CustomerFinancialAccountDiscrepancyType;
  severity: 'WARNING' | 'ERROR';
  owner: CustomerFinancialAccountDiscrepancyOwner;
  recoveryState: CustomerFinancialAccountRecoveryState;
  bindingId: string | null;
  customerId: string | null;
  customerWalletId: string | null;
  walletAccountId: string | null;
  ledgerAccountId: string | null;
  currency: string | null;
  accountingUnit: string | null;
  scopeValue: string | null;
  message: string;
}

export interface CustomerFinancialAccountReconciliationSummary {
  bindingsChecked: number;
  activeBindingsChecked: number;
  customerWalletsChecked: number;
  financialWalletsChecked: number;
  discrepancies: number;
  errors: number;
  warnings: number;
  byType: Record<string, number>;
}

export interface CustomerFinancialAccountReconciliationReport {
  status: VerificationStatus;
  generatedAt: string;
  summary: CustomerFinancialAccountReconciliationSummary;
  discrepancies: CustomerFinancialAccountDiscrepancy[];
  repairPerformed: false;
}
