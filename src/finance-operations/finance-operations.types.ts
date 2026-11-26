/**
 * Admin Web Finance Operations — read contracts.
 *
 * Three concerns share one surface because an operator investigates them together:
 *
 * 1. **Ledger & reversals** — find a posted journal by a supported reference and a date range, see
 *    its accounts and postings, follow it back to the source transaction, and take an eligible
 *    journal through the *existing* governed reversal request/approval/execution workflow.
 * 2. **Reconciliation breaks** — an internal double-entry check failure or an external provider
 *    observation difference, with the institution, what was checked, where/when the result came
 *    from, and the next action the caller is actually permitted to take.
 * 3. **Banking operations** — provider readiness and exception evidence, kept separate from any
 *    claim that a reconciliation succeeded.
 *
 * Nothing in this module writes a financial record. Reversal execution is delegated to
 * `LedgerReversalGovernanceService`; exception resolution is delegated to
 * `BankingReconciliationService`. The only state this surface changes is the existing approval
 * decision the governance services already own.
 */

export type FinanceInstitutionScopedMode = 'PLATFORM' | 'INSTITUTIONS' | 'NONE';

export interface FinanceInstitutionSummary {
  id: string;
  code: string;
  name: string;
  status: string;
}

export interface FinanceInstitutionScopeView {
  mode: FinanceInstitutionScopedMode;
  /** Empty for PLATFORM, which sees every institution. */
  institutionIds: string[];
  /** `institution.attribution.view` — the explicit catalogue marker for platform-level staff. */
  platformFunctionGranted: boolean;
}

/** A source transaction this journal was posted for, where an authoritative link exists. */
export type JournalSourceType =
  | 'TRANSFER'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'CASH_OUT_EXECUTION'
  | 'INBOUND_FUNDING'
  | 'CUSTOMER_FUNDING'
  | 'AGENT_FUNDING'
  | 'CASH_TO_CASH'
  | 'BANK_TO_WALLET';

export interface JournalSourceLink {
  type: JournalSourceType;
  id: string;
  reference: string | null;
  status: string;
  /** Which column/relation established the link, so an operator can tell evidence from inference. */
  linkedBy: 'JOURNAL_ID' | 'CLAIM_JOURNAL_ID' | 'DURABLE_INBOUND_LINK' | 'LEGACY_RECEIPT_JOURNAL';
  /** True only when the admin console can open that exact source record. */
  navigable: boolean;
}

export interface JournalReversalState {
  /** `NORMAL` = neither a reversal nor reversed; `IS_REVERSAL` = this journal reverses another. */
  kind: 'NORMAL' | 'IS_REVERSAL' | 'REVERSED';
  reversalOfJournalId: string | null;
  reversedByJournalId: string | null;
}

export interface CashLedgerJournalSummary {
  id: string;
  reference: string | null;
  description: string | null;
  status: string;
  currency: string;
  accountingUnit: string;
  totalMinor: string;
  lineCount: number;
  institution: FinanceInstitutionSummary | null;
  source: JournalSourceLink | null;
  reversal: JournalReversalState;
  createdAt: string;
  postedAt: string;
  /** Present on detail reads only. */
  idempotencyKey?: string;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CashLedgerJournalLine {
  id: string;
  lineNumber: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  institutionalScope: string;
  institutionId: string | null;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: string;
  currency: string;
  accountingUnit: string;
}

export interface CashLedgerJournalDetail extends CashLedgerJournalSummary {
  idempotencyKey: string;
  correlationId: string | null;
  metadata: Record<string, unknown>;
  lines: CashLedgerJournalLine[];
}

export interface JournalSearchResponse {
  items: CashLedgerJournalSummary[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  range: { from: string; to: string };
  scope: FinanceInstitutionScopeView;
  /** The reference forms this endpoint actually searches. Stated so the UI need not guess. */
  supportedReferenceForms: string[];
}

export type ReversalNextAction =
  | 'REQUEST_REVERSAL'
  | 'AWAIT_APPROVAL'
  | 'EXECUTE_REVERSAL'
  | 'NONE';

export interface ReversalBlocker {
  code: string;
  message: string;
  /** Who/what can clear the blocker. Never the caller's own pessimistic guess. */
  action: string;
}

export interface ReversalApprovalView {
  approvalId: string;
  status: string;
  requestedAt: string;
  expiresAt: string;
  requestedBy: string;
  approvedBy: string | null;
  /** The maker's reason. Execution must repeat it exactly (the server binds it by fingerprint). */
  reason: string;
  actionType: string;
  resourceType: string;
}

export interface ReversalEligibilityView {
  journalId: string;
  eligible: boolean;
  nextAction: ReversalNextAction;
  nextActionLabel: string;
  reasonCode: string;
  reason: string;
  permissions: {
    canView: boolean;
    canRequest: boolean;
    canExecute: boolean;
  };
  approval: ReversalApprovalView | null;
  blockers: ReversalBlocker[];
  governance: {
    actionType: string;
    resourceType: string;
    makerRole: string;
    checkerRole: string;
    note: string;
  };
}

export interface TransactionJournalLinkResponse {
  transaction: {
    id: string;
    type: JournalSourceType;
    reference: string | null;
    status: string;
    createdAt: string;
  };
  ledgerAccess: 'GRANTED' | 'DENIED_LEDGER_VIEW';
  journal: CashLedgerJournalSummary | null;
  /** Machine-readable: NO_JOURNAL_POSTED | SOURCE_NOT_FOUND | LEDGER_ACCESS_DENIED | FOUND. */
  outcome: 'FOUND' | 'NO_JOURNAL_POSTED' | 'SOURCE_NOT_FOUND' | 'LEDGER_ACCESS_DENIED';
  message: string;
}

export type ReconciliationCheckSource =
  | 'INTERNAL_LEDGER'
  | 'EXTERNAL_PROVIDER'
  | 'EXTERNAL_STATEMENT';

export type ReconciliationSourceAvailability = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';

export type ReconciliationSourceResult =
  | 'AGREED'
  | 'DIFFERENCES'
  | 'EVIDENCE_RECORDED'
  | 'NOT_PERFORMED'
  | 'UNAVAILABLE';

export interface ReconciliationSourceView {
  source: ReconciliationCheckSource;
  label: string;
  availability: ReconciliationSourceAvailability;
  /**
   * What this source established. `NOT_PERFORMED` is deliberately distinct from `AGREED`: absent
   * evidence is never a reconciliation success.
   */
  result: ReconciliationSourceResult;
  /** What this source actually compares. Never summed into another source's result. */
  description: string;
  evidenceKind: string;
  checkedAt: string | null;
  detail: string;
  providerKeys: string[];
}

export type FinanceBreakState =
  | 'WARNING'
  | 'ERROR'
  | 'OPEN'
  | 'INVESTIGATING'
  | 'RESOLVED'
  | 'UNAVAILABLE';

export type FinanceBreakSeverity = 'INFO' | 'REVIEW' | 'CRITICAL' | 'ERROR';

export interface FinanceBreakNextAction {
  code: string;
  label: string;
  permitted: boolean;
  reason: string;
  targetKind: 'BANKING_EXCEPTION' | 'JOURNAL' | 'PROVIDER_CONFIGURATION' | 'NONE';
  targetId: string | null;
}

export interface FinanceBreakEvidence {
  kind: string;
  available: boolean;
  reference: string | null;
  observedAt: string | null;
  note: string;
}

export interface FinanceBreakView {
  id: string;
  source: ReconciliationCheckSource;
  /** Stable machine name of the check, e.g. `journal_balance_integrity`. */
  checkName: string;
  title: string;
  state: FinanceBreakState;
  severity: FinanceBreakSeverity;
  institution: FinanceInstitutionSummary;
  subject: { type: string; reference: string } | null;
  amounts: {
    internalMinor: string | null;
    providerMinor: string | null;
    currency: string;
  } | null;
  detail: string;
  checkedAt: string;
  evidence: FinanceBreakEvidence[];
  nextAction: FinanceBreakNextAction;
  run: {
    id: string;
    providerKey: string;
    environment: string;
    state: string;
    startedAt: string;
    completedAt: string | null;
    failureCode: string | null;
  } | null;
  provider: {
    providerKey: string;
    environment: string;
    readinessState: string;
    usable: boolean;
    summary: string;
  } | null;
  journalId: string | null;
}

export interface FinanceCheckView {
  name: string;
  source: ReconciliationCheckSource;
  label: string;
  description: string;
  status: 'PASS' | 'WARNING' | 'ERROR' | 'UNAVAILABLE';
  checkedAt: string;
  evidenceCount: number;
  detail: string;
}

export interface ProviderReadinessView {
  providerKey: string;
  environment: string;
  state: string;
  usable: boolean;
  entitled: 'UNKNOWN';
  summary: string;
  reconciliationCapability: {
    state: string;
    usable: boolean;
  } | null;
}

export interface ReconciliationBreaksResponse {
  institution: FinanceInstitutionSummary;
  generatedAt: string;
  sources: ReconciliationSourceView[];
  checks: FinanceCheckView[];
  breaks: FinanceBreakView[];
  providerReadiness: ProviderReadinessView[];
  /** True only when at least one source actually established a reconciled result. Never inferred. */
  reconciliationEstablished: boolean;
  summary: {
    breaks: number;
    errors: number;
    warnings: number;
    unavailableSources: number;
    checksRun: number;
    checksPassed: number;
    externalExceptionsOpen: number;
    providerReady: boolean;
  };
  filters: {
    source: ReconciliationCheckSource | 'ALL';
    state: string;
    from: string | null;
    to: string | null;
    reference: string | null;
  };
  scope: FinanceInstitutionScopeView;
}

export interface FinanceInstitutionsResponse {
  items: FinanceInstitutionSummary[];
  scope: FinanceInstitutionScopeView;
}

/** Internal helper shapes (not serialized directly). */
export interface InternalLedgerCheckResult {
  checks: FinanceCheckView[];
  breaks: FinanceBreakView[];
}
