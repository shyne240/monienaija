import type { ExternalCallbackReceiptStatus } from '../partner/external-callback.enums';
import type { ExternalOperationLifecycleState } from '../partner/external-operation-lifecycle.enums';
import type {
  ExternalOperationReferenceSource,
  ExternalOperationReferenceType,
} from '../partner/external-operation.enums';
import type {
  ExternalSettlementDecision,
  ExternalSettlementStatus,
  ExternalSuspenseStatus,
} from '../partner/external-settlement.enums';
import type { ExternalReconciliationDiscrepancyCode } from './external-reconciliation.enums';
import type { VerificationStatus } from './reconciliation.types';

export type ExternalReconciliationSeverity = 'WARNING' | 'ERROR';
export type ExternalReconciliationOwner =
  | 'RECONCILIATION'
  | 'FINANCE'
  | 'SECURITY'
  | 'PARTNER_OWNER'
  | 'WALLET'
  | 'OPERATIONS';
export type ExternalReconciliationSensitivity =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'CONFIDENTIAL'
  | 'RESTRICTED';
export type ExternalReconciliationRecoveryState = 'NO_AUTOMATIC_REPAIR' | 'MANUAL_REVIEW_REQUIRED';

export interface ExternalReconciliationDiscrepancy {
  key: string;
  code: ExternalReconciliationDiscrepancyCode;
  severity: ExternalReconciliationSeverity;
  owner: ExternalReconciliationOwner;
  recoveryState: ExternalReconciliationRecoveryState;
  externalOperationId: string | null;
  settlementId: string | null;
  journalId: string | null;
  suspenseEntryId: string | null;
  providerReferenceId: string | null;
  callbackReceiptId: string | null;
  scopeValue: string | null;
  message: string;
}

export interface ExternalReconciliationOperationFact {
  id: string;
  operationVersion: number;
  partnerKey: string;
  capabilityKey: string;
  operationType: string;
  resourceType: string;
  resourceId: string;
  internalCommandId: string;
  customerId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  targetMappingReference: string;
  amountMinor: string;
  currency: string;
  accountingUnit: string;
  lifecycleState: ExternalOperationLifecycleState;
  requestHash: string;
  correlationId: string;
  requestId: string;
  attemptCount: number;
  maxAttempts: number;
  version: number;
}

export interface ExternalReconciliationReferenceFact {
  id: string;
  externalOperationId: string;
  partnerKey: string;
  referenceType: ExternalOperationReferenceType;
  referenceValueHash: string;
  referenceValue: string;
  namespace: string;
  source: ExternalOperationReferenceSource;
  observedAt: Date;
}

export interface ExternalReconciliationCallbackFact {
  id: string;
  externalOperationId: string | null;
  partnerKey: string;
  callbackEventId: string;
  payloadHash: string;
  signatureHash: string;
  providerReferenceType: ExternalOperationReferenceType;
  providerReferenceValueHash: string;
  providerReferenceNamespace: string;
  providerStatus: string;
  providerOccurredAt: Date;
  receivedAt: Date;
  correlationId: string;
  status: ExternalCallbackReceiptStatus;
  rejectionCode: string | null;
}

export interface ExternalReconciliationSettlementFact {
  id: string;
  externalOperationId: string;
  externalOperationReference: string;
  partnerKey: string;
  capabilityKey: string;
  operationType: string;
  customerId: string;
  walletAccountId: string;
  customerLedgerAccountId: string;
  settlementAssetLedgerAccountId: string;
  decision: ExternalSettlementDecision;
  status: ExternalSettlementStatus;
  amountMinor: string;
  currency: string;
  accountingUnit: string;
  lifecycleState: string;
  journalId: string | null;
  reversalJournalId: string | null;
  evidenceType: ExternalOperationReferenceType;
  evidenceValueHash: string;
  evidenceValue: string;
  evidenceNamespace: string;
  evidenceSource: string;
  evidenceHash: string;
  idempotencyScope: string;
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  requestId: string;
  ownerPrincipal: string;
  postedAt: Date | null;
  reversalPostedAt: Date | null;
}

export interface ExternalReconciliationSuspenseFact {
  id: string;
  externalOperationId: string;
  externalOperationReference: string;
  customerId: string;
  amountMinor: string;
  currency: string;
  accountingUnit: string;
  reason: string;
  status: ExternalSuspenseStatus;
  owner: string;
  ownerPrincipal: string;
  evidenceHash: string;
  lifecycleState: string;
  rejectionCode: string;
  correlationId: string;
  requestId: string;
  reversalJournalId: string | null;
  settlementId: string | null;
  clearedAt: Date | null;
  createdAt: Date;
  agedHours: number;
}

export interface ExternalReconciliationJournalLineFact {
  id: string;
  journalId: string;
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: string;
  currency: string;
  accountingUnit: string;
}

export interface ExternalReconciliationJournalFact {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  currency: string;
  accountingUnit: string;
  status: string;
  reference: string | null;
  description: string | null;
  correlationId: string | null;
  reversalOfJournalId: string | null;
  totalMinor: string;
  postedAt: Date | null;
  externalOperationReference: string | null;
  evidenceHash: string | null;
  partnerKey: string | null;
  capabilityKey: string | null;
  operationType: string | null;
  verifiedProviderReferenceType: string | null;
  verifiedProviderReferenceValue: string | null;
  verifiedProviderReferenceNamespace: string | null;
  verifiedProviderSource: string | null;
  settlementId: string | null;
  externalOperationId: string | null;
}

export interface ExternalReconciliationAuditFact {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  correlationId: string | null;
  newValuesSummary: Record<string, unknown> | null;
}

export interface ExternalReconciliationOutboxFact {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  eventKey: string | null;
  schemaVersion: number;
  correlationId: string | null;
  causationId: string | null;
  payloadSummary: Record<string, unknown>;
}

export interface ExternalReconciliationIdempotencyHint {
  scope: string;
  key: string;
  status: string;
  requestHash: string;
  resourceId: string | null;
  expiresAt: Date | null;
  match: 'MATCH' | 'MISMATCH' | 'IN_PROGRESS' | 'MISSING' | 'EXPIRED';
}

export interface PartnerCertificationEvidence {
  partnerKey: string;
  capabilityKey: string;
  capabilityVersion: string;
  adapterVersion: string;
  contractName: string;
  contractVersion: number;
  contractReference: string;
  contractDocument: string;
  expectedChecks: string[];
  observedChecks: string[];
  reportStatus: VerificationStatus;
  fingerprint: string;
  evidenceHash: string;
  producedAt: string;
  notes: string;
}

export interface ExternalReconciliationTrace {
  externalOperationId: string;
  internalCommandId: string;
  customerId: string;
  walletAccountId: string;
  customerLedgerAccountId: string;
  settlementAssetLedgerAccountId: string | null;
  partnerKey: string;
  capabilityKey: string;
  operationType: string;
  externalOperationReference: string;
  externalSettlementId: string | null;
  externalSettlementJournalId: string | null;
  externalSettlementReversalJournalId: string | null;
  externalSettlementReference: string | null;
  externalSettlementIdempotencyKey: string | null;
  providerReferenceIds: string[];
  callbackReceiptIds: string[];
  suspenseEntryIds: string[];
  outboxEventIds: string[];
  auditEventIds: string[];
  correlationId: string;
  supportClassification: ExternalReconciliationSensitivity;
  generatedAt: string;
}

export interface ExternalReconciliationFacts {
  externalOperationId: string;
  operation: ExternalReconciliationOperationFact | null;
  references: ExternalReconciliationReferenceFact[];
  callbacks: ExternalReconciliationCallbackFact[];
  settlement: ExternalReconciliationSettlementFact | null;
  suspenseEntries: ExternalReconciliationSuspenseFact[];
  journal: ExternalReconciliationJournalFact | null;
  journalLines: ExternalReconciliationJournalLineFact[];
  auditEvents: ExternalReconciliationAuditFact[];
  outboxEvents: ExternalReconciliationOutboxFact[];
  idempotencyHints: ExternalReconciliationIdempotencyHint[];
}

export interface ExternalReconciliationReport {
  contractName: 'A6-EXTERNAL-RECONCILIATION';
  contractVersion: 1;
  generatedAt: string;
  readOnly: true;
  status: VerificationStatus;
  externalOperationId: string;
  operation: ExternalReconciliationOperationFact | null;
  references: ExternalReconciliationReferenceFact[];
  callbacks: ExternalReconciliationCallbackFact[];
  settlement: ExternalReconciliationSettlementFact | null;
  suspenseEntries: ExternalReconciliationSuspenseFact[];
  journal: ExternalReconciliationJournalFact | null;
  journalLines: ExternalReconciliationJournalLineFact[];
  auditEvents: ExternalReconciliationAuditFact[];
  outboxEvents: ExternalReconciliationOutboxFact[];
  idempotencyHints: ExternalReconciliationIdempotencyHint[];
  discrepancies: ExternalReconciliationDiscrepancy[];
  trace: ExternalReconciliationTrace;
  certification: PartnerCertificationEvidence;
  replayHash: string | null;
  repairPerformed: false;
}

export interface ExternalReconciliationBatchReport {
  contractName: 'A6-EXTERNAL-RECONCILIATION';
  contractVersion: 1;
  generatedAt: string;
  readOnly: true;
  status: VerificationStatus;
  reports: ExternalReconciliationReport[];
  discrepancies: number;
  repairPerformed: false;
}
