import { ApiClient } from './api-client';

/**
 * ARENA 4 — typed customer banking reads.
 *
 * Every value here comes from an existing authenticated, SELF-only endpoint. Nothing is derived,
 * simulated or cached: a missing wallet, an absent account number or an unavailable product is
 * represented as the absence the backend actually reported.
 */

export interface CustomerDashboardWallet {
  id: string;
  currency: string;
  status: string;
  balanceMinor: string;
}

export interface CustomerDashboardTransactionCounterparty {
  displayName?: string | null;
  receivingNumber?: string | null;
  agentId?: string | null;
  beneficiaryPhone?: string | null;
  reference?: string | null;
}

export interface CustomerDashboardTransaction {
  id: string;
  type: string;
  narration: string | null;
  reference: string | null;
  amountMinor: string | number;
  currency: string;
  direction: string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  counterparty?: CustomerDashboardTransactionCounterparty | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export interface CustomerDashboard {
  identity: {
    id: string;
    reference: string;
    type: string;
    status: string;
    kycLevel: string;
    kycStatus: string;
    createdAt: string;
  };
  profile: { id: string; displayName: string | null; legalName: string | null } | null;
  balance: {
    wallets: CustomerDashboardWallet[];
    primary: CustomerDashboardWallet | null;
  };
  receivingIdentity: string | null;
  recentTransactions: {
    items: CustomerDashboardTransaction[];
    pagination?: { page: number; limit: number; total: number };
  };
}

export type KycUpgradePathwayStatus =
  'TOP_TIER' | 'POLICY_NOT_CONFIGURED' | 'MANUAL_REVIEW' | 'EVIDENCE_UNAVAILABLE';

export interface CustomerKycProjection {
  customerId: string;
  kycLevel: string;
  kycStatus: string;
  assessment: {
    level: string;
    status: string;
    reason: string | null;
    expiresAt: string | null;
  } | null;
  policy: { configured: boolean; version: number | null };
  requirements: {
    level: 'LEVEL_1' | 'LEVEL_2';
    regulatory: { all: string[]; any: string[][] };
    operator: { all: string[]; any: string[][] };
  } | null;
  evidenceAssessment: {
    status: 'UNAVAILABLE';
    reason: 'TRUSTED_EVIDENCE_UNAVAILABLE';
    note: string;
  };
  lastEvaluation: {
    outcome: string;
    reason: string;
    newLevel: string | null;
    policyVersion: number | null;
    decidedAt: string;
  } | null;
  manualHold: { reason: string; since: string } | null;
  upgradePathway: { status: KycUpgradePathwayStatus; nextLevel: 'LEVEL_1' | 'LEVEL_2' | null };
  asOf: string;
}

export interface CustomerLimitWindow {
  dimension: string;
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  kind: 'AMOUNT' | 'COUNT';
  limitMinor: string | null;
  limitCount: number | null;
  remainingMinor: string | null;
  remainingCount: number | null;
}

export interface CustomerLimitProduct {
  product: string;
  direction: 'INCOMING' | 'OUTGOING';
  currency: string;
  configured: boolean;
  perTransactionMinMinor: string | null;
  perTransactionMaxMinor: string | null;
  walletBalanceMaxMinor: string | null;
  windows: CustomerLimitWindow[];
}

export interface CustomerLimits {
  customerId: string;
  currency: string;
  asOf: string;
  products: CustomerLimitProduct[];
}

export interface TransactionDetail {
  id: string;
  type?: string;
  status: string;
  amountMinor: string;
  currency: string;
  feeMinor?: string;
  vatMinor?: string;
  reference?: string | null;
  narration?: string | null;
  createdAt: string;
  completedAt?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  direction?: string;
  counterparty?: CustomerDashboardTransactionCounterparty | null;
  [key: string]: unknown;
}

/** `CustomerFundingSafeHistoryView` — already stripped of ledger/journal/internal fields by the backend. */
export interface FundingRequestRow {
  id: string;
  reference: string | null;
  amountMinor: string;
  currency: string;
  status: string;
  externalReference: string | null;
  channel: string | null;
  description: string | null;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export const CustomerAccountApi = {
  dashboard: () => ApiClient.get<CustomerDashboard>('/customers/me/dashboard'),
  kyc: () => ApiClient.get<CustomerKycProjection>('/customers/me/kyc'),
  limits: () => ApiClient.get<CustomerLimits>('/customers/me/limits'),
  transaction: (transactionId: string) =>
    ApiClient.get<TransactionDetail>(
      `/customers/me/transactions/${encodeURIComponent(transactionId)}`,
    ),
  /** Same projection as `customers/me/funding-history`: items + pagination, customer-safe. */
  fundingRequests: (page = 1, limit = 10) =>
    ApiClient.get<{ items?: FundingRequestRow[] }>(
      `/customers/me/funding-requests?page=${page}&limit=${limit}`,
    ).then((value) => asArray<FundingRequestRow>(value?.items)),
};
