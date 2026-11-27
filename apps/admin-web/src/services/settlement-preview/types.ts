/**
 * Provider-neutral contracts for the settlement report preview.
 *
 * These types deliberately know nothing about Monnify. A provider adapter converts a provider
 * document into these rows; the shared matcher below only ever sees these rows. That boundary is
 * what allows a NIBSS adapter to be added without changing matching, review or display logic.
 *
 * The preview is read-only by construction: this module contains no API client, no mutation and
 * no reference to balances, journals, transfers or refunds.
 */

export type ReportKind = 'COLLECTIONS' | 'PAYOUTS' | 'SETTLEMENTS';
export type ProviderKey = 'MONNIFY' | 'NIBSS';
export type DocumentFormat = 'DOCUMENTED_API_JSON' | 'WEBHOOK_EVENT_JSON';

export interface SettlementDestination {
  accountNumber?: string;
  accountName?: string;
  bankCode?: string;
  bankName?: string;
}

/** One normalised provider row, independent of the source file's field names. */
export interface ProviderRow {
  provider: ProviderKey;
  kind: ReportKind;
  format: DocumentFormat;
  fileName: string;
  /** Content fingerprint of the uploaded document; duplicate detection only, not security. */
  documentFingerprint: string;
  rowNumber: number;
  /** Field names actually present in the uploaded document, for honest column display. */
  observedColumns: string[];
  providerTransactionReference?: string;
  merchantReference?: string;
  settlementReference?: string;
  nipSessionId?: string;
  nipSessionIdSource?: string;
  amountMinor: string;
  settlementAmountMinor?: string;
  feeMinor?: string;
  currency: string;
  status: string;
  occurredAt?: string;
  settlementDestination?: SettlementDestination;
  raw: Record<string, unknown>;
}

/** A scoped internal record supplied by a redacted/synthetic internal snapshot. */
export interface InternalRecord {
  id: string;
  reference?: string;
  businessReference?: string;
  providerTransactionReference?: string;
  settlementReference?: string;
  nipSessionId?: string;
  amountMinor: string;
  currency: string;
  status: string;
  type: string;
  journalId?: string;
  institutionId?: string;
}

/** A bank or wallet statement line for the actual settlement destination. */
export interface StatementEntry {
  id: string;
  date: string;
  amountMinor: string;
  currency: string;
  settlementReference?: string;
  destinationAccountNumber?: string;
  destinationBankCode?: string;
  narration?: string;
}

export type ParseFailureCode =
  | 'UNVERIFIED_CSV_FORMAT'
  | 'UNSUPPORTED_PROVIDER'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_DOCUMENT';

export interface ParseFailure {
  ok: false;
  code: ParseFailureCode;
  message: string;
  /** Exact export to request when a dashboard sample is missing. */
  exactExportNeeded?: string;
}

export interface ParseSuccess {
  ok: true;
  provider: ProviderKey;
  format: DocumentFormat;
  kind: ReportKind;
  rows: ProviderRow[];
  /** Collection rows embedded in a settlement notification; matched as transactions, not as net. */
  embeddedCollections: ProviderRow[];
  documentFingerprint: string;
  observedColumns: string[];
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface ProviderAdapter {
  readonly provider: ProviderKey;
  readonly label: string;
  readonly confirmedFormats: string[];
  /** Explicitly refuses formats without a redacted sample; never guesses a header. */
  parse(fileName: string, content: string): ParseResult;
}

export type TransactionOutcome =
  | 'MATCHED'
  | 'UNMATCHED'
  | 'MISMATCH'
  | 'AMBIGUOUS'
  | 'DUPLICATE_UPLOAD';

export interface TransactionMatch {
  row: ProviderRow;
  outcome: TransactionOutcome;
  keyUsed: string | null;
  reasons: string[];
  internalRecord: InternalRecord | null;
  candidates: InternalRecord[];
  /** Transaction agreement never establishes settlement agreement. */
  settlementEstablished: false;
}

export type SettlementOutcome =
  | 'MATCHED'
  | 'MISMATCH'
  | 'AMBIGUOUS'
  | 'UNMATCHED'
  | 'UNVERIFIED_DESTINATION'
  | 'DUPLICATE_UPLOAD'
  | 'NOT_PERFORMED';

export interface SettlementMatch {
  settlement: ProviderRow | null;
  outcome: SettlementOutcome;
  reasons: string[];
  keyUsed: string | null;
  statementEntry: StatementEntry | null;
  candidates: StatementEntry[];
  /** Sum of settlementAmount on embedded PAID collection rows, when available. */
  expectedNetMinor: string | null;
}

export interface ReviewItem {
  id: string;
  category: 'AMBIGUOUS' | 'MISMATCH' | 'UNMATCHED' | 'DUPLICATE_UPLOAD' | 'SETTLEMENT';
  severity: 'REVIEW' | 'CRITICAL';
  reference: string;
  detail: string;
}

export interface PreviewResult {
  generatedAt: string;
  transactions: TransactionMatch[];
  settlements: SettlementMatch[];
  reviewQueue: ReviewItem[];
  summary: {
    providerRows: number;
    matched: number;
    unmatched: number;
    mismatches: number;
    ambiguous: number;
    duplicateUploads: number;
    netSettlementMatches: number;
    netSettlementProblems: number;
    /** Always false: an upload alone never establishes external settlement. */
    reconciliationEstablished: false;
  };
}
