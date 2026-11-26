/**
 * Finance → Reconciliation, "Platform Funds vs. Bank Balance" — read/write contracts.
 *
 * What this surface is for: an authorized Finance maker records that a bank or settlement account
 * holds an actual, independently verified balance as of a stated cutoff, and the server computes
 * what the *ledger* says MonieNaija expects to be in that account. The difference, the timing
 * items Finance records with references and explanations, and the remaining unexplained difference
 * are kept separate and reviewable. An independent checker (FINANCE_CONTROLLER) signs the
 * comparison off — or rejects it — through the existing maker/checker approval machinery.
 *
 * What this surface is NOT: it never moves money, never posts a ledger adjustment, and never
 * marks an external bank reconciliation as performed. The automated provider reconciliation
 * (`/internal/finance-operations/reconciliation/breaks`, banking exception governance) is a
 * different workflow with different evidence; this surface only compares ledger evidence with a
 * staff-entered, independently verified bank balance. `NOT_PERFORMED` remains the only truth for
 * provider-side evidence here, by design.
 */

export type PlatformFundsComparisonScope = 'PLATFORM' | 'INSTITUTION';
export type PlatformFundsComparisonStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/** Breakdown buckets. Every ledger account in the comparison universe maps to exactly one. */
export type PlatformFundsBucketKey =
  | 'CUSTOMER_WALLETS'
  | 'AGENT_FLOAT'
  | 'UNPAID_AGENT_COMMISSIONS'
  | 'PLATFORM_EARNINGS_HELD'
  | 'OTHER_HELD'
  | 'SETTLEMENT_CLEARING'
  | 'SECONDARY_SETTLEMENT_ASSETS'
  | 'CONTROL_SUBLEDGER'
  | 'UNMAPPED';

/** Why a bucket row exists, so the screen can caption it honestly. */
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
  /** True when this exact set of rows backs the selected account for this caller. */
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
  /** Raw signed totals as of the ledger cutoff (posted journals only). */
  debitMinor: string;
  creditMinor: string;
  /** House convention: normal-balance-signed balance. */
  balanceMinor: string;
  /** credits − debits. Every account in the universe contributes exactly this once. */
  contributionMinor: string;
  lineCount: number;
  /** Sub-line grouping within the bucket (e.g. suspense vs withdrawal reserve vs unclaimed). */
  subLine: string;
}

export interface PlatformFundsBucketLine {
  key: PlatformFundsBucketKey;
  label: string;
  kind: PlatformFundsLineKind;
  /** Per-line captions the UI renders verbatim. */
  note: string;
  /** Sub-line grouping for OTHER_HELD rows and the earnings composition. */
  group: string;
  accounts: PlatformFundsAccountEvidence[];
  debitMinor: string;
  creditMinor: string;
  contributionMinor: string;
}

export interface PlatformFundsBlocker {
  code: string;
  /** What Finance must resolve. Never a pessimistic guess; always an instruction. */
  message: string;
  needed: string;
  accountCode?: string | null;
  accountId?: string | null;
}

export interface PlatformFundsControlLine {
  key: 'INSTITUTION_SUBLEDGER_NET_ZERO' | 'PLATFORM_BOOKS_NET_ZERO';
  label: string;
  /** Signed credits−debits over the other books. MUST be exactly "0" when mapping is complete. */
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
  scope: PlatformFundsComparisonScope;
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
    /** Net debit of the selected account as of the cutoff — the ledger's expected bank balance. */
    expectedMinor: string;
    debitMinor: string;
    creditMinor: string;
    balanceMinor: string;
    lineCount: number;
  };
  lines: PlatformFundsBucketLine[];
  controlLine: PlatformFundsControlLine;
  /** Σ contributions of every line. Must equal settlementAccount.expectedMinor when mappingComplete. */
  breakdownTotalMinor: string;
  /** breakdownTotal − expected. Zero when mapping is complete (and conservation holds). */
  reconciliationGapMinor: string;
  mappingComplete: boolean;
  blockers: PlatformFundsBlocker[];
  journalEvidence: PlatformFundsJournalEvidence;
  /** Informational notes (e.g. family resolved via fallback code, family not provisioned). */
  notes: string[];
  /** Deterministic sha256 of the canonical evidence core; shown to reviewers. */
  evidenceHash: string;
  generatedAt: string;
}

export interface PlatformFundsTimingItem {
  id: string;
  title: string;
  reference: string;
  explanation: string;
  /** Signed: positive explains why the bank holds MORE than the ledger expects. */
  amountMinor: string;
  createdBy: string;
  createdAt: string;
}

export interface PlatformFundsComparisonSummary {
  id: string;
  scope: PlatformFundsComparisonScope;
  institutionId: string | null;
  settlementAccountId: string;
  settlementAccountCode: string;
  settlementAccountName: string;
  currency: string;
  accountingUnit: string;
  status: PlatformFundsComparisonStatus;
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

export interface PlatformFundsSnapshotView {
  id: string;
  comparisonId: string;
  version: number;
  reason: string;
  evidenceHash: string;
  createdBy: string;
  createdAt: string;
  snapshot: PlatformFundsBreakdown & {
    comparisonId: string;
    bankCutoff: string;
    statementReference: string;
    bankBalanceMinor: string;
    differenceMinor: string;
    timingItems: PlatformFundsTimingItem[];
    timingTotalMinor: string;
    unexplainedMinor: string;
    snapshotReason: string;
    snapshotVersion: number;
  };
}

export interface PlatformFundsListResponse {
  items: PlatformFundsComparisonSummary[];
  total: number;
  limit: number;
  offset: number;
  scope: {
    mode: 'PLATFORM' | 'INSTITUTIONS' | 'NONE';
    institutionIds: string[];
    platformFunctionGranted: boolean;
  };
}

export interface PlatformFundsScopeView {
  mode: 'PLATFORM' | 'INSTITUTIONS' | 'NONE';
  institutionIds: string[];
  platformFunctionGranted: boolean;
}
