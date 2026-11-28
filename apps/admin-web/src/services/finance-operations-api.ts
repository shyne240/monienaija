import { ApiClient } from './api-client';

/**
 * Admin Web Finance Operations API layer.
 *
 * Thin wrappers over `/internal/finance-operations/*`. The server decides institution scope from
 * `workforce_institution_assignments` on every request; nothing here sends or implies a scope.
 *
 * Two server statements are carried verbatim into the types because the UI must not soften them:
 *
 * - `reconciliationEstablished` is true only when every source actually established agreement. A
 *   missing provider or statement result is `NOT_PERFORMED`/`UNAVAILABLE`, never a pass.
 * - `nextAction.permitted` is the server's decision. The screen disables the control when false and
 *   shows the reason; it never offers an action the caller cannot perform.
 */

export interface FinanceInstitutionSummary {
  id: string;
  code: string;
  name: string;
  status: string;
}

export interface FinanceInstitutionScope {
  mode: 'PLATFORM' | 'INSTITUTIONS' | 'NONE';
  institutionIds: string[];
  platformFunctionGranted: boolean;
}

export interface JournalSourceLink {
  type: string;
  id: string;
  reference: string | null;
  status: string;
  linkedBy:
    | 'JOURNAL_ID'
    | 'CLAIM_JOURNAL_ID'
    | 'DURABLE_INBOUND_LINK'
    | 'LEGACY_RECEIPT_JOURNAL'
    | 'DIRECT_CREDIT_JOURNAL';
  navigable: boolean;
}

export interface JournalReversalState {
  kind: 'NORMAL' | 'IS_REVERSAL' | 'REVERSED';
  reversalOfJournalId: string | null;
  reversedByJournalId: string | null;
}

export interface LedgerJournalSummary {
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
}

export interface LedgerJournalLine {
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

export interface LedgerJournalDetail extends LedgerJournalSummary {
  idempotencyKey: string;
  correlationId: string | null;
  metadata: Record<string, unknown>;
  lines: LedgerJournalLine[];
}

export interface JournalSearchResponse {
  items: LedgerJournalSummary[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  range: { from: string; to: string };
  scope: FinanceInstitutionScope;
  supportedReferenceForms: string[];
}

export type ReversalNextAction =
  | 'REQUEST_REVERSAL'
  | 'AWAIT_APPROVAL'
  | 'EXECUTE_REVERSAL'
  | 'NONE';

export interface ReversalEligibility {
  journalId: string;
  eligible: boolean;
  nextAction: ReversalNextAction;
  nextActionLabel: string;
  reasonCode: string;
  reason: string;
  permissions: { canView: boolean; canRequest: boolean; canExecute: boolean };
  approval: {
    approvalId: string;
    status: string;
    requestedAt: string;
    expiresAt: string;
    requestedBy: string;
    approvedBy: string | null;
    actionType: string;
    resourceType: string;
    reason: string;
  } | null;
  blockers: Array<{ code: string; message: string; action: string }>;
  governance: {
    actionType: string;
    resourceType: string;
    makerRole: string;
    checkerRole: string;
    note: string;
  };
}

export interface TransactionJournalLink {
  transaction: {
    id: string;
    type: string;
    reference: string | null;
    status: string;
    createdAt: string;
  };
  ledgerAccess: 'GRANTED' | 'DENIED_LEDGER_VIEW';
  journal: LedgerJournalSummary | null;
  outcome: 'FOUND' | 'NO_JOURNAL_POSTED' | 'SOURCE_NOT_FOUND' | 'LEDGER_ACCESS_DENIED';
  message: string;
}

export type ReconciliationCheckSource =
  | 'INTERNAL_LEDGER'
  | 'EXTERNAL_PROVIDER'
  | 'EXTERNAL_STATEMENT';

export interface ReconciliationSource {
  source: ReconciliationCheckSource;
  label: string;
  availability: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  result: 'AGREED' | 'DIFFERENCES' | 'EVIDENCE_RECORDED' | 'NOT_PERFORMED' | 'UNAVAILABLE';
  description: string;
  evidenceKind: string;
  checkedAt: string | null;
  detail: string;
  providerKeys: string[];
}

export interface ReconciliationCheck {
  name: string;
  source: ReconciliationCheckSource;
  label: string;
  description: string;
  status: 'PASS' | 'WARNING' | 'ERROR' | 'UNAVAILABLE';
  checkedAt: string;
  evidenceCount: number;
  detail: string;
}

export interface FinanceBreakNextAction {
  code: string;
  label: string;
  permitted: boolean;
  reason: string;
  targetKind: 'BANKING_EXCEPTION' | 'JOURNAL' | 'PROVIDER_CONFIGURATION' | 'NONE';
  targetId: string | null;
}

export interface FinanceBreak {
  id: string;
  source: ReconciliationCheckSource;
  checkName: string;
  title: string;
  state: 'WARNING' | 'ERROR' | 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'UNAVAILABLE';
  severity: 'INFO' | 'REVIEW' | 'CRITICAL' | 'ERROR';
  institution: FinanceInstitutionSummary;
  subject: { type: string; reference: string } | null;
  amounts: { internalMinor: string | null; providerMinor: string | null; currency: string } | null;
  detail: string;
  checkedAt: string;
  evidence: Array<{
    kind: string;
    available: boolean;
    reference: string | null;
    observedAt: string | null;
    note: string;
  }>;
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

export interface ProviderReadiness {
  providerKey: string;
  environment: string;
  state: string;
  usable: boolean;
  entitled: 'UNKNOWN';
  summary: string;
  reconciliationCapability: { state: string; usable: boolean } | null;
}

export interface ReconciliationBreaksResponse {
  institution: FinanceInstitutionSummary;
  generatedAt: string;
  sources: ReconciliationSource[];
  checks: ReconciliationCheck[];
  breaks: FinanceBreak[];
  providerReadiness: ProviderReadiness[];
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
  scope: FinanceInstitutionScope;
}

export interface ReconciliationInstitutionsResponse {
  items: FinanceInstitutionSummary[];
  scope: FinanceInstitutionScope;
}

export interface JournalSearchQuery {
  reference?: string;
  from?: string;
  to?: string;
  institutionId?: string;
  limit?: number;
  offset?: number;
}

export const FinanceOperationsApi = {
  searchJournals: (query: JournalSearchQuery) => {
    const params = new URLSearchParams();
    if (query.reference?.trim()) params.set('reference', query.reference.trim());
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.institutionId) params.set('institutionId', query.institutionId);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    const suffix = params.toString();
    return ApiClient.get<JournalSearchResponse>(
      `/internal/finance-operations/ledger/journals${suffix ? `?${suffix}` : ''}`,
    );
  },

  journal: (journalId: string) =>
    ApiClient.get<LedgerJournalDetail>(
      `/internal/finance-operations/ledger/journals/${encodeURIComponent(journalId)}`,
    ),

  reversalEligibility: (journalId: string) =>
    ApiClient.get<ReversalEligibility>(
      `/internal/finance-operations/ledger/journals/${encodeURIComponent(journalId)}/reversal-eligibility`,
    ),

  transactionJournal: (transactionId: string, type?: string) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    const suffix = params.toString();
    return ApiClient.get<TransactionJournalLink>(
      `/internal/finance-operations/transactions/${encodeURIComponent(transactionId)}/journal${suffix ? `?${suffix}` : ''}`,
    );
  },

  reconciliationInstitutions: () =>
    ApiClient.get<ReconciliationInstitutionsResponse>(
      '/internal/finance-operations/reconciliation/institutions',
    ),

  reconciliationBreaks: (query: {
    institutionId: string;
    source?: string;
    state?: string;
    severity?: string;
    kind?: string;
    reference?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) => {
    const params = new URLSearchParams({ institutionId: query.institutionId });
    for (const key of ['source', 'state', 'severity', 'kind', 'reference', 'from', 'to'] as const) {
      const value = query[key];
      if (value) params.set(key, value);
    }
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    return ApiClient.get<ReconciliationBreaksResponse>(
      `/internal/finance-operations/reconciliation/breaks?${params.toString()}`,
    );
  },
};
