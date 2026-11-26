import { ApiClient } from './api-client';

/**
 * Admin Web API layer for Finance → Reconciliation, "Platform Funds vs. Bank Balance".
 *
 * Thin wrappers over `/internal/finance-operations/platform-funds/*`. The server decides
 * institution scope from `workforce_institution_assignments` on every request; role gates
 * (FINANCE_PREPARER records/submits, FINANCE_CONTROLLER reviews) are enforced server-side and
 * re-checked here only to render controls honestly. Nothing in this module can move money or
 * post a ledger adjustment.
 */

export type PlatformFundsScope = 'PLATFORM' | 'INSTITUTION';
export type PlatformFundsStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type PlatformFundsLineKind =
  | 'CUSTOMER_FUNDS'
  | 'AGENT_COMMISSION_ACCRUAL'
  | 'PLATFORM_REVENUE'
  | 'PAYMENT_OBLIGATION'
  | 'UNALLOCATED'
  | 'IN_TRANSIT'
  | 'ASSET'
  | 'CONTROL';

export interface PlatformFundsSettlementAccountOption {
  id: string;
  code: string;
  name: string;
  accountType: string;
  currency: string;
  scope: 'UNATTRIBUTED' | 'PLATFORM' | 'INSTITUTION';
  institutionId: string | null;
  institutionCode: string | null;
  selectable: boolean;
  unavailableReason: string | null;
}

export interface PlatformFundsAccountEvidence {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  scope: string;
  institutionId: string | null;
  institutionalPurpose: string | null;
  debitMinor: string;
  creditMinor: string;
  balanceMinor: string;
  contributionMinor: string;
  lineCount: number;
  subLine: string;
}

export interface PlatformFundsBucketLine {
  key: string;
  label: string;
  kind: PlatformFundsLineKind;
  group: string;
  note: string;
  accounts: PlatformFundsAccountEvidence[];
  debitMinor: string;
  creditMinor: string;
  contributionMinor: string;
}

export interface PlatformFundsBlocker {
  code: string;
  message: string;
  needed: string;
  accountCode?: string | null;
  accountId?: string | null;
}

export interface PlatformFundsControlLine {
  key: 'INSTITUTION_SUBLEDGER_NET_ZERO' | 'PLATFORM_BOOKS_NET_ZERO';
  label: string;
  netMinor: string;
  ok: boolean;
  accountCount: number;
}

export interface PlatformFundsJournalEvidence {
  ledgerCutoff: string;
  journalsConsidered: number;
  linesConsidered: string;
  maxPostedAt: string | null;
  totalDebitsMinor: string;
  totalCreditsMinor: string;
  conserved: boolean;
}

export interface PlatformFundsBreakdown {
  scope: PlatformFundsScope;
  currency: string;
  accountingUnit: string;
  ledgerCutoff: string;
  settlementAccount: {
    id: string;
    code: string;
    name: string;
    accountType: string;
    normalBalance: string;
    scope: string;
    institutionId: string | null;
    institutionalPurpose: string | null;
    expectedMinor: string;
    debitMinor: string;
    creditMinor: string;
    balanceMinor: string;
    lineCount: number;
  };
  lines: PlatformFundsBucketLine[];
  controlLine: PlatformFundsControlLine;
  breakdownTotalMinor: string;
  reconciliationGapMinor: string;
  mappingComplete: boolean;
  blockers: PlatformFundsBlocker[];
  journalEvidence: PlatformFundsJournalEvidence;
  notes: string[];
  evidenceHash: string;
  generatedAt: string;
}

export interface PlatformFundsTimingItem {
  id: string;
  title: string;
  reference: string;
  explanation: string;
  amountMinor: string;
  createdBy: string;
  createdAt: string;
}

export interface PlatformFundsComparisonSummary {
  id: string;
  scope: PlatformFundsScope;
  institutionId: string | null;
  settlementAccountId: string;
  settlementAccountCode: string;
  settlementAccountName: string;
  currency: string;
  accountingUnit: string;
  status: PlatformFundsStatus;
  ledgerCutoff: string;
  bankCutoff: string;
  statementReference: string;
  bankBalanceMinor: string;
  expectedMinor: string;
  differenceMinor: string;
  timingTotalMinor: string;
  unexplainedMinor: string;
  mappingComplete: boolean;
  createdBy: string;
  createdAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface PlatformFundsComparisonDetail extends PlatformFundsComparisonSummary {
  blockers: PlatformFundsBlocker[];
  decisionReason: string | null;
  timingItems: PlatformFundsTimingItem[];
  breakdown: PlatformFundsBreakdown;
  approvalId: string | null;
  approval: {
    id: string;
    status: string;
    actionType: string;
    requestedBy: string;
    approvedBy: string | null;
    requestedAt: string;
    expiresAt: string;
    reason: string;
  } | null;
  selfApprovalDenied: boolean;
  snapshotCount: number;
  canSubmit: boolean;
  canReview: boolean;
  blockingReasons: string[];
}

export interface PlatformFundsScopeView {
  mode: 'PLATFORM' | 'INSTITUTIONS' | 'NONE';
  institutionIds: string[];
  platformFunctionGranted: boolean;
}

export interface PlatformFundsListResponse {
  items: PlatformFundsComparisonSummary[];
  total: number;
  limit: number;
  offset: number;
  scope: PlatformFundsScopeView;
}

export interface PlatformFundsSnapshotItem {
  id: string;
  comparisonId: string;
  version: number;
  reason: string;
  evidenceHash: string;
  createdBy: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

export const PlatformFundsApi = {
  scope: () => ApiClient.get<PlatformFundsScopeView>('/internal/finance-operations/platform-funds/scope'),

  settlementAccounts: () =>
    ApiClient.get<{ items: PlatformFundsSettlementAccountOption[] }>(
      '/internal/finance-operations/platform-funds/settlement-accounts',
    ),

  list: (query: { scope?: PlatformFundsScope; status?: PlatformFundsStatus; institutionId?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.scope) params.set('scope', query.scope);
    if (query.status) params.set('status', query.status);
    if (query.institutionId) params.set('institutionId', query.institutionId);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    const suffix = params.toString();
    return ApiClient.get<PlatformFundsListResponse>(
      `/internal/finance-operations/platform-funds/comparisons${suffix ? `?${suffix}` : ''}`,
    );
  },

  preview: (body: { settlementAccountId: string; ledgerCutoff: string }) =>
    ApiClient.post<PlatformFundsBreakdown>(
      '/internal/finance-operations/platform-funds/comparisons/preview',
      body,
    ),

  create: (body: {
    settlementAccountId: string;
    ledgerCutoff: string;
    bankCutoff: string;
    statementReference: string;
    bankBalanceMinor: string;
  }) =>
    ApiClient.post<PlatformFundsComparisonDetail>(
      '/internal/finance-operations/platform-funds/comparisons',
      body,
    ),

  detail: (comparisonId: string) =>
    ApiClient.get<PlatformFundsComparisonDetail>(
      `/internal/finance-operations/platform-funds/comparisons/${encodeURIComponent(comparisonId)}`,
    ),

  update: (
    comparisonId: string,
    body: {
      ledgerCutoff?: string;
      bankCutoff?: string;
      statementReference?: string;
      bankBalanceMinor?: string;
    },
  ) =>
    ApiClient.patch<PlatformFundsComparisonDetail>(
      `/internal/finance-operations/platform-funds/comparisons/${encodeURIComponent(comparisonId)}`,
      body,
    ),

  addTimingItem: (
    comparisonId: string,
    body: { title: string; reference: string; explanation: string; amountMinor: string },
  ) =>
    ApiClient.post<PlatformFundsComparisonDetail>(
      `/internal/finance-operations/platform-funds/comparisons/${encodeURIComponent(comparisonId)}/timing-items`,
      body,
    ),

  removeTimingItem: (comparisonId: string, itemId: string) =>
    ApiClient.delete<PlatformFundsComparisonDetail>(
      `/internal/finance-operations/platform-funds/comparisons/${encodeURIComponent(comparisonId)}/timing-items/${encodeURIComponent(itemId)}`,
    ),

  submit: (comparisonId: string, body: { reason: string }) =>
    ApiClient.post<PlatformFundsComparisonDetail>(
      `/internal/finance-operations/platform-funds/comparisons/${encodeURIComponent(comparisonId)}/submit`,
      body,
    ),

  review: (comparisonId: string, body: { decision: 'APPROVE' | 'REJECT'; reason: string }) =>
    ApiClient.post<PlatformFundsComparisonDetail>(
      `/internal/finance-operations/platform-funds/comparisons/${encodeURIComponent(comparisonId)}/review`,
      body,
    ),

  snapshots: (comparisonId: string) =>
    ApiClient.get<{ items: PlatformFundsSnapshotItem[] }>(
      `/internal/finance-operations/platform-funds/comparisons/${encodeURIComponent(comparisonId)}/snapshots`,
    ),
};
