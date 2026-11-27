import { ApiClient } from './api-client';

export type SettlementReportType =
  | 'COLLECTIONS'
  | 'PAYOUTS'
  | 'SETTLEMENTS'
  | 'WALLET_STATEMENT'
  | 'BANK_STATEMENT'
  | 'REFUNDS_DISPUTES';

export type StatementDestination = 'MONNIFY_WALLET' | 'BANK_ACCOUNT' | 'UNSPECIFIED';

export type ReconciliationReviewState = 'NONE' | 'PROPOSED' | 'APPROVED' | 'REJECTED';

export interface SettlementReportFormatDescriptor {
  providerKey: string;
  providerDisplayName: string;
  reportType: SettlementReportType;
  fileFormat: 'CSV' | 'JSON';
  supported: boolean;
  verificationStatus: 'VERIFIED_OFFICIAL_API_JSON' | 'UNVERIFIED_MISSING_REDACTED_EXPORT';
  adapterSpecProvenance: 'SYNTHETIC_ADAPTER_SPEC';
  documentedSource: string;
  missingSampleNeeded: string | null;
  note: string;
}

export interface WorkspaceOverviewResponse {
  capabilities: {
    canImportAndPropose: boolean;
    canReview: boolean;
    mfaVerified: boolean;
    hasPlatformAuthority: boolean;
    assignedInstitutionIds: string[];
  };
  selectableInstitutions: Array<{ id: string; code: string; displayName: string }>;
  formatDescriptors: SettlementReportFormatDescriptor[];
  summary: {
    importsCount: number;
    unverifiedFormatImportsCount: number;
    matchedTransactionsCount: number;
    exceptionTransactionsCount: number;
    pendingTransactionReviewsCount: number;
    reconciledSettlementsCount: number;
    openSettlementBreaksCount: number;
    pendingSettlementReviewsCount: number;
    openReturnDisputeCasesCount: number;
    reconciledReturnDisputeCasesCount: number;
    pendingReturnDisputeReviewsCount: number;
  };
}

export interface ImportSettlementReportPayload {
  institutionId?: string;
  providerKey: string;
  reportType: SettlementReportType;
  fileName: string;
  content: string;
  periodStart?: string;
  periodEnd?: string;
  statementDestination?: StatementDestination;
  defaultCurrency?: string;
  note?: string;
}

export interface ImportPreviewResponse {
  providerKey: string;
  reportType: SettlementReportType;
  fileFormat: 'CSV' | 'JSON';
  scope: 'PLATFORM' | 'INSTITUTION';
  institutionId: string | null;
  fileName: string;
  contentSha256: string;
  alreadyImportedFileId: string | null;
  verificationStatus: string;
  verificationNote: string;
  missingSampleNeeded: string | null;
  currency: string;
  detectedMaskedAccount: string | null;
  totalRows: number;
  validRowsCount: number;
  rejectedRowsCount: number;
  intraFileDuplicateRowsCount: number;
  priorImportDuplicateRowsCount: number;
  grossTotalMinor: string;
  providerFeeTotalMinor: string;
  netTotalMinor: string;
  financeReviewRowsCount?: number;
  internalMerchantSettlementTotalMinor?: string;
  internalPlatformFeeTotalMinor?: string;
  internalCustomerCreditTotalMinor?: string;
  predictedCounts: Record<string, number>;
  sampleValidRows: Array<{
    rowNumber: number;
    direction: string;
    providerTransactionReference: string | null;
    platformReference: string | null;
    settlementReference: string | null;
    nipSessionId: string | null;
    grossAmountMinor: string;
    providerFeeMinor: string;
    netAmountMinor: string;
    providerStatus: string;
    occurredAt: string | null;
    maskedAccount: string | null;
    predictedStatus?: string;
    requiresFinanceReview?: boolean;
    internalMerchantSettlementMinor?: string | null;
    internalPlatformFeeMinor?: string | null;
    internalCustomerCreditMinor?: string | null;
    ambiguousCandidatesCount?: number;
    explanation?: string;
  }>;
  rejectedRows: Array<{
    rowNumber: number;
    reasonCode: string;
    message: string;
    sanitizedPreview: Record<string, string | null>;
  }>;
}

export interface SettlementImportSummary {
  id: string;
  scope: string;
  institutionId: string | null;
  institutionCode: string | null;
  providerKey: string;
  reportType: SettlementReportType;
  fileFormat: 'CSV' | 'JSON';
  verificationStatus: string;
  statementDestination: StatementDestination;
  maskedStatementAccount: string | null;
  sourceFilename: string;
  contentSha256: string;
  byteLength: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  grossTotalMinor: string;
  providerFeeTotalMinor: string;
  netTotalMinor: string;
  importedBy: string;
  importerNote: string | null;
  importedAt: string;
}

export interface SettlementImportDetail extends SettlementImportSummary {
  rows: Array<{
    id: string;
    rowNumber: number;
    direction: string;
    providerTransactionReference: string | null;
    platformReference: string | null;
    paymentReference: string | null;
    settlementReference: string | null;
    payoutReference: string | null;
    nipSessionId: string | null;
    refundOrDisputeReference: string | null;
    currency: string;
    grossAmountMinor: string;
    providerFeeMinor: string;
    netAmountMinor: string;
    runningBalanceAfterMinor: string | null;
    providerStatus: string;
    occurredAt: string | null;
    settledAt: string | null;
    maskedCounterpartyAccount: string | null;
    maskedDestinationAccount: string | null;
    counterpartyBankCode: string | null;
    narration: string | null;
  }>;
  rejections: Array<{
    id: string;
    rowNumber: number;
    reasonCode: string;
    message: string;
    sanitizedPreview: Record<string, string | null>;
  }>;
}

export interface AmbiguousMatchCandidate {
  sourceType: string;
  sourceId: string;
  businessReference: string | null;
  providerReference: string | null;
  grossAmountMinor: string;
  providerFeeMinor: string;
  netAmountMinor: string;
  status: string;
  occurredAt: string | null;
  reason: string;
}

export interface SettlementTransactionMatchItem {
  id: string;
  scope: string;
  institutionId: string | null;
  institutionCode: string | null;
  providerKey: string;
  reportType: string;
  importId: string;
  reportRowId: string | null;
  direction: string;
  matchStatus: string;
  matchedKeys: string[];
  explanation: string;
  currency: string;
  providerReference: string | null;
  providerPlatformReference: string | null;
  providerPaymentReference: string | null;
  nipSessionId: string | null;
  maskedAccount: string | null;
  providerGrossMinor: string | null;
  providerFeeMinor: string | null;
  providerNetMinor: string | null;
  providerStatus: string | null;
  providerOccurredAt: string | null;
  internalSourceType: string | null;
  internalSourceId: string | null;
  internalBusinessReference: string | null;
  internalProviderReference: string | null;
  internalGrossMinor: string | null;
  internalProviderFeeMinor: string | null;
  internalNetMinor: string | null;
  internalPlatformFeeMinor: string | null;
  internalCustomerCreditMinor: string | null;
  internalStatus: string | null;
  internalOccurredAt: string | null;
  internalTransactionHistoryPath: string | null;
  internalJournalIds: string[];
  varianceMinor: string;
  feeVarianceMinor: string;
  ambiguousCandidates: AmbiguousMatchCandidate[];
  reviewState: ReconciliationReviewState;
  proposedDecision: string | null;
  selectedCandidateId: string | null;
  linkedJournalId: string | null;
  proposedNote: string | null;
  proposedBy: string | null;
  proposedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface SettlementBatchReconciliationItem {
  id: string;
  scope: string;
  institutionId: string | null;
  institutionCode: string | null;
  providerKey: string;
  settlementReference: string;
  payoutReference: string | null;
  settlementRowId: string | null;
  statementRowId: string | null;
  statementDestination: StatementDestination;
  maskedDestinationAccount: string | null;
  currency: string;
  grossCollectionsMinor: string;
  providerFeeTotalMinor: string;
  expectedNetSettlementMinor: string;
  platformFeeTotalMinor: string;
  customerWalletCreditTotalMinor: string;
  reportedNetSettlementMinor: string;
  statementCreditMinor: string | null;
  varianceMinor: string;
  matchedCollectionCount: number;
  missingCollectionCount: number;
  settledAt: string | null;
  batchStatus: string;
  explanation: string;
  reviewState: ReconciliationReviewState;
  proposedDecision: string | null;
  linkedJournalId: string | null;
  linkedComparisonId: string | null;
  proposedNote: string | null;
  proposedBy: string | null;
  proposedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface SettlementBatchDetail extends SettlementBatchReconciliationItem {
  underlyingItems: Array<{
    providerTransactionReference: string;
    paymentReference: string | null;
    platformReference: string | null;
    grossAmountMinor: string;
    providerFeeMinor: string;
    netSettlementMinor: string;
    currency: string;
    paidAt: string | null;
    providerStatus: string;
  }>;
  candidateStatementCredits: Array<{
    id: string;
    reportType: string;
    reference: string | null;
    settlementReference: string | null;
    payoutReference: string | null;
    amountMinor: string;
    occurredAt: string | null;
    maskedAccount: string | null;
    narration: string | null;
  }>;
}

export interface ReturnDisputeCaseItem {
  id: string;
  caseKey: string;
  scope: string;
  institutionId: string | null;
  institutionCode: string | null;
  providerKey: string;
  caseKind: string;
  originalSourceType: string | null;
  originalSourceId: string | null;
  originalBusinessReference: string | null;
  originalProviderReference: string | null;
  originalCurrency: string;
  originalGrossMinor: string | null;
  originalProviderFeeMinor: string | null;
  originalNetMinor: string | null;
  originalCustomerCreditMinor: string | null;
  originalInternalStatus: string | null;
  originalOccurredAt: string | null;
  originalJournalIds: string[];
  returnOrDisputeReference: string | null;
  eventAmountMinor: string | null;
  eventFeeMinor: string;
  providerEventStatus: string | null;
  internalReturnStatus: string | null;
  providerReportRowId: string | null;
  statementRowId: string | null;
  linkedInternalDisputeId: string | null;
  linkedReversalJournalId: string | null;
  lifecycleStatus: string;
  varianceMinor: string;
  explanation: string;
  reviewState: ReconciliationReviewState;
  proposedDecision: string | null;
  proposedNote: string | null;
  proposedBy: string | null;
  proposedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface ReturnDisputeCaseDetail extends ReturnDisputeCaseItem {
  events: Array<{
    id: string;
    eventSource: string;
    eventType: string;
    statusLabel: string;
    amountMinor: string | null;
    feeMinor: string | null;
    reference: string | null;
    actor: string | null;
    detail: string;
    occurredAt: string;
    recordedAt: string;
  }>;
}

const BASE = '/internal/finance-operations/settlement-reconciliation';

function toQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, v);
  }
  const str = sp.toString();
  return str ? `?${str}` : '';
}

export const SettlementReconciliationApi = {
  overview: (query: { institutionId?: string } = {}) =>
    ApiClient.get<WorkspaceOverviewResponse>(`${BASE}/overview${toQuery(query)}`),

  previewImport: (payload: ImportSettlementReportPayload) =>
    ApiClient.post<ImportPreviewResponse>(`${BASE}/imports/preview`, payload),

  importReport: (payload: ImportSettlementReportPayload) =>
    ApiClient.post<{
      idempotentReplay: boolean;
      priorImportDuplicateRowsSkipped: number;
      importRecord: SettlementImportDetail;
    }>(`${BASE}/imports`, payload),

  listImports: (
    query: { institutionId?: string; reportType?: SettlementReportType; search?: string } = {},
  ) => ApiClient.get<{ items: SettlementImportSummary[] }>(`${BASE}/imports${toQuery(query)}`),

  getImportDetail: (importId: string) =>
    ApiClient.get<SettlementImportDetail>(`${BASE}/imports/${encodeURIComponent(importId)}`),

  listTransactionMatches: (
    query: {
      institutionId?: string;
      reportType?: SettlementReportType;
      status?: string;
      importId?: string;
      search?: string;
    } = {},
  ) =>
    ApiClient.get<{ items: SettlementTransactionMatchItem[] }>(
      `${BASE}/transaction-matches${toQuery(query)}`,
    ),

  getTransactionMatchDetail: (matchId: string) =>
    ApiClient.get<SettlementTransactionMatchItem>(
      `${BASE}/transaction-matches/${encodeURIComponent(matchId)}`,
    ),

  proposeTransactionMatch: (
    matchId: string,
    payload: {
      decision: string;
      selectedCandidateId?: string;
      linkedJournalId?: string;
      note: string;
    },
  ) =>
    ApiClient.post<SettlementTransactionMatchItem>(
      `${BASE}/transaction-matches/${encodeURIComponent(matchId)}/propose`,
      payload,
    ),

  reviewTransactionMatch: (
    matchId: string,
    payload: { decision: 'APPROVE' | 'REJECT'; note: string },
  ) =>
    ApiClient.post<SettlementTransactionMatchItem>(
      `${BASE}/transaction-matches/${encodeURIComponent(matchId)}/review`,
      payload,
    ),

  listSettlementBatches: (
    query: { institutionId?: string; status?: string; search?: string } = {},
  ) =>
    ApiClient.get<{ items: SettlementBatchReconciliationItem[] }>(
      `${BASE}/settlement-batches${toQuery(query)}`,
    ),

  getSettlementBatchDetail: (batchId: string) =>
    ApiClient.get<SettlementBatchDetail>(
      `${BASE}/settlement-batches/${encodeURIComponent(batchId)}`,
    ),

  proposeSettlementBatch: (
    batchId: string,
    payload: {
      decision: string;
      linkedStatementRowId?: string;
      linkedJournalId?: string;
      linkedComparisonId?: string;
      note: string;
    },
  ) =>
    ApiClient.post<SettlementBatchDetail>(
      `${BASE}/settlement-batches/${encodeURIComponent(batchId)}/propose`,
      payload,
    ),

  reviewSettlementBatch: (
    batchId: string,
    payload: { decision: 'APPROVE' | 'REJECT'; note: string },
  ) =>
    ApiClient.post<SettlementBatchDetail>(
      `${BASE}/settlement-batches/${encodeURIComponent(batchId)}/review`,
      payload,
    ),

  listReturnDisputeCases: (
    query: { institutionId?: string; status?: string; search?: string } = {},
  ) =>
    ApiClient.get<{ items: ReturnDisputeCaseItem[] }>(
      `${BASE}/return-dispute-cases${toQuery(query)}`,
    ),

  getReturnDisputeCaseDetail: (caseId: string) =>
    ApiClient.get<ReturnDisputeCaseDetail>(
      `${BASE}/return-dispute-cases/${encodeURIComponent(caseId)}`,
    ),

  proposeReturnDisputeCase: (
    caseId: string,
    payload: {
      decision: string;
      linkedJournalId?: string;
      linkedInternalDisputeId?: string;
      note: string;
    },
  ) =>
    ApiClient.post<ReturnDisputeCaseDetail>(
      `${BASE}/return-dispute-cases/${encodeURIComponent(caseId)}/propose`,
      payload,
    ),

  reviewReturnDisputeCase: (
    caseId: string,
    payload: { decision: 'APPROVE' | 'REJECT'; note: string },
  ) =>
    ApiClient.post<ReturnDisputeCaseDetail>(
      `${BASE}/return-dispute-cases/${encodeURIComponent(caseId)}/review`,
      payload,
    ),
};
