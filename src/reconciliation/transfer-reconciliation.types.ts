import type { TransferStatus } from '../transfer/transfer.enums';

export type TransferReconciliationSeverity = 'WARNING' | 'ERROR';
export type TransferReconciliationStatus = 'PASS' | 'WARNING' | 'ERROR';

export enum TransferReconciliationDiscrepancyCode {
  TRANSFER_NOT_FOUND = 'TRANSFER_NOT_FOUND',
  ORPHAN_TRANSFER = 'ORPHAN_TRANSFER',
  ORPHAN_JOURNAL = 'ORPHAN_JOURNAL',
  MISSING_JOURNAL = 'MISSING_JOURNAL',
  DUPLICATE_JOURNAL = 'DUPLICATE_JOURNAL',
  JOURNAL_CORRELATION_MISMATCH = 'JOURNAL_CORRELATION_MISMATCH',
  JOURNAL_LINE_COUNT_MISMATCH = 'JOURNAL_LINE_COUNT_MISMATCH',
  DEBIT_CREDIT_UNBALANCED = 'DEBIT_CREDIT_UNBALANCED',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  CURRENCY_MISMATCH = 'CURRENCY_MISMATCH',
  ACCOUNTING_UNIT_MISMATCH = 'ACCOUNTING_UNIT_MISMATCH',
  SOURCE_ACCOUNT_MISMATCH = 'SOURCE_ACCOUNT_MISMATCH',
  DESTINATION_ACCOUNT_MISMATCH = 'DESTINATION_ACCOUNT_MISMATCH',
  MISSING_OUTBOX_EVENT = 'MISSING_OUTBOX_EVENT',
  DUPLICATE_OUTBOX_EVENT = 'DUPLICATE_OUTBOX_EVENT',
  OUTBOX_PAYLOAD_MISMATCH = 'OUTBOX_PAYLOAD_MISMATCH',
  MISSING_AUDIT_EVENT = 'MISSING_AUDIT_EVENT',
  AUDIT_CORRELATION_MISMATCH = 'AUDIT_CORRELATION_MISMATCH',
  QUERY_UNAVAILABLE = 'QUERY_UNAVAILABLE',
}

export interface TransferReconciliationDiscrepancy {
  code: TransferReconciliationDiscrepancyCode;
  severity: TransferReconciliationSeverity;
  message: string;
  transferId: string | null;
  journalId: string | null;
  outboxEventId: string | null;
  auditEventId: string | null;
}

export interface TransferReconciliationTransferFact {
  id: string;
  commandId: string | null;
  status: TransferStatus;
  sourceCustomerId: string | null;
  destinationCustomerId: string | null;
  sourceWalletAccountId: string;
  destinationWalletAccountId: string;
  sourceLedgerAccountId: string | null;
  destinationLedgerAccountId: string | null;
  amountMinor: string;
  currency: string;
  accountingUnit: string | null;
  journalId: string | null;
  requestHash: string;
  correlationId: string | null;
  causationId: string | null;
}

export interface TransferReconciliationJournalFact {
  id: string;
  idempotencyKey: string;
  currency: string;
  accountingUnit: string;
  totalMinor: string;
  correlationId: string | null;
  transferId: string | null;
}

export interface TransferReconciliationLineFact {
  id: string;
  journalId: string;
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: string;
  currency: string;
  accountingUnit: string;
}

export interface TransferReconciliationOutboxFact {
  id: string;
  eventKey: string | null;
  eventType: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  correlationId: string | null;
  causationId: string | null;
  payload: Record<string, unknown>;
}

export interface TransferReconciliationAuditFact {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  correlationId: string | null;
  newValues: Record<string, unknown> | null;
}

export interface TransferReconciliationFacts {
  transfer: TransferReconciliationTransferFact | null;
  journal: TransferReconciliationJournalFact | null;
  journalCandidates: readonly TransferReconciliationJournalFact[];
  lines: readonly TransferReconciliationLineFact[];
  outboxEvents: readonly TransferReconciliationOutboxFact[];
  auditEvents: readonly TransferReconciliationAuditFact[];
}

export interface TransferReconciliationTrace {
  transferId: string | null;
  commandId: string | null;
  sourceCustomerId: string | null;
  destinationCustomerId: string | null;
  sourceLedgerAccountId: string | null;
  destinationLedgerAccountId: string | null;
  journalId: string | null;
  outboxEventIds: string[];
  auditEventIds: string[];
  correlationId: string | null;
  causationId: string | null;
}

export interface TransferReconciliationReport {
  status: TransferReconciliationStatus;
  generatedAt: string;
  readOnly: true;
  transfer: TransferReconciliationTransferFact | null;
  trace: TransferReconciliationTrace;
  discrepancies: TransferReconciliationDiscrepancy[];
}

export interface TransferReconciliationBatchReport {
  status: TransferReconciliationStatus;
  generatedAt: string;
  readOnly: true;
  reports: TransferReconciliationReport[];
  discrepancies: number;
}
