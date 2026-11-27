import { createHash } from 'node:crypto';

export type SettlementReconciliationScope = 'PLATFORM' | 'INSTITUTION';
export type SettlementReportScope = SettlementReconciliationScope;

export const SETTLEMENT_REPORT_TYPES = [
  'COLLECTIONS',
  'PAYOUTS',
  'SETTLEMENTS',
  'WALLET_STATEMENT',
  'BANK_STATEMENT',
  'REFUNDS_DISPUTES',
] as const;

export type SettlementReportType = (typeof SETTLEMENT_REPORT_TYPES)[number];

export const STATEMENT_DESTINATIONS = ['MONNIFY_WALLET', 'BANK_ACCOUNT', 'UNSPECIFIED'] as const;

export type StatementDestination = (typeof STATEMENT_DESTINATIONS)[number];
export type SettlementDestinationType = StatementDestination;

export type SettlementFileFormat = 'JSON' | 'CSV';

export type FormatVerificationStatus =
  | 'VERIFIED_OFFICIAL_API_JSON'
  | 'UNVERIFIED_MISSING_REDACTED_EXPORT';

export type SettlementRowDirection =
  | 'INBOUND'
  | 'OUTBOUND'
  | 'SETTLEMENT'
  | 'STATEMENT_CREDIT'
  | 'STATEMENT_DEBIT'
  | 'RETURN_EVENT';

export type TransactionMatchStatus =
  | 'MATCHED'
  | 'MISSING_INTERNAL'
  | 'MISSING_IN_PROVIDER'
  | 'AMOUNT_MISMATCH'
  | 'FEE_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'DATE_WINDOW_MISMATCH'
  | 'DUPLICATE_PROVIDER_ROW'
  | 'AMBIGUOUS_CANDIDATES';

export const TRANSACTION_MATCH_DECISIONS = [
  'SELECT_CANDIDATE',
  'CONFIRM_TIMING_DIFFERENCE',
  'CONFIRM_FEE_VARIANCE',
  'ESCALATE_MISSING_INTERNAL',
  'ESCALATE_MISSING_IN_PROVIDER',
  'ESCALATE_STATUS_CONFLICT',
  'LINK_EXISTING_JOURNAL',
] as const;

export type TransactionMatchDecision = (typeof TRANSACTION_MATCH_DECISIONS)[number];

export type ReconciliationReviewState = 'NONE' | 'PROPOSED' | 'APPROVED' | 'REJECTED';

export type SettlementBatchStatus =
  | 'RECONCILED'
  | 'NET_AMOUNT_MISMATCH'
  | 'FEE_MISMATCH'
  | 'MISSING_COLLECTION_DETAIL'
  | 'STATEMENT_UNMATCHED'
  | 'PAYOUT_FAILED_OR_PENDING'
  | 'AMBIGUOUS';

export const SETTLEMENT_DECISIONS = [
  'CONFIRM_RECONCILED',
  'LINK_STATEMENT_ENTRY',
  'CONFIRM_TIMING_IN_TRANSIT',
  'ESCALATE_VARIANCE',
] as const;

export type SettlementDecision = (typeof SETTLEMENT_DECISIONS)[number];

export type ReturnDisputeCaseKind =
  | 'VOLUNTARY_REFUND'
  | 'APPROVED_RETURN_AWAITING_CONFIRMATION'
  | 'OUTBOUND_DISBURSEMENT_REVERSAL'
  | 'INBOUND_COLLECTION_REVERSAL'
  | 'CHARGEBACK_OR_LIEN'
  | 'CUSTOMER_DISPUTE_LINKED';

export type ReturnDisputeLifecycleStatus =
  | 'AWAITING_PROVIDER_CONFIRMATION'
  | 'PROVIDER_CONFIRMED_UNMATCHED_INTERNAL'
  | 'AMOUNT_OR_FEE_VARIANCE'
  | 'AMBIGUOUS'
  | 'RECONCILED';

export const RETURN_DISPUTE_DECISIONS = [
  'CONFIRM_RECONCILED',
  'AWAIT_PROVIDER_COMPLETION',
  'LINK_REVERSAL_JOURNAL',
  'LINK_INTERNAL_DISPUTE',
  'ESCALATE_UNMATCHED_CHARGEBACK',
] as const;

export type ReturnDisputeResolutionDecision = (typeof RETURN_DISPUTE_DECISIONS)[number];

export interface AmbiguousMatchCandidate {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly businessReference: string | null;
  readonly providerReference: string | null;
  readonly grossAmountMinor: string;
  readonly providerFeeMinor: string;
  readonly netAmountMinor: string;
  readonly status: string;
  readonly occurredAt: string | null;
  readonly reason: string;
}

export interface SettlementReportFormatDescriptor {
  readonly providerKey: string;
  readonly providerDisplayName: string;
  readonly reportType: SettlementReportType;
  readonly fileFormat: SettlementFileFormat;
  readonly supported: boolean;
  readonly verificationStatus: FormatVerificationStatus;
  readonly adapterSpecProvenance: 'SYNTHETIC_ADAPTER_SPEC';
  readonly documentedSource: string;
  readonly missingSampleNeeded: string | null;
  readonly note: string;
}

export interface SettlementUnderlyingCollectionItem {
  readonly providerTransactionReference: string;
  readonly paymentReference: string | null;
  readonly platformReference: string | null;
  readonly grossAmountMinor: string;
  readonly providerFeeMinor: string;
  readonly netSettlementMinor: string;
  readonly currency: string;
  readonly paidAt: string | null;
  readonly providerStatus: string;
}

export interface NormalizedSettlementReportRow {
  readonly rowNumber: number;
  readonly direction: SettlementRowDirection;
  readonly providerTransactionReference: string | null;
  readonly platformReference: string | null;
  readonly paymentReference: string | null;
  readonly settlementReference: string | null;
  readonly payoutReference: string | null;
  readonly nipSessionId: string | null;
  readonly refundOrDisputeReference: string | null;
  readonly currency: string;
  readonly grossAmountMinor: string;
  readonly providerFeeMinor: string;
  readonly netAmountMinor: string;
  readonly runningBalanceAfterMinor: string | null;
  readonly providerStatus: string;
  readonly occurredAt: string | null;
  readonly settledAt: string | null;
  readonly maskedCounterpartyAccount: string | null;
  readonly maskedDestinationAccount: string | null;
  readonly counterpartyBankCode: string | null;
  readonly narration: string | null;
  readonly underlyingItems: readonly SettlementUnderlyingCollectionItem[];
  readonly normalizedAttributes: Readonly<Record<string, string | number | boolean | null>>;
  readonly rowFingerprint: string;
}

export interface RejectedSettlementReportRow {
  readonly rowNumber: number;
  readonly reasonCode: string;
  readonly message: string;
  readonly sanitizedPreview: Readonly<Record<string, string | null>>;
}

export interface ParsedSettlementReport {
  readonly providerKey: string;
  readonly reportType: SettlementReportType;
  readonly fileFormat: SettlementFileFormat;
  readonly verificationStatus: FormatVerificationStatus;
  readonly verificationNote: string;
  readonly missingSampleNeeded: string | null;
  readonly currency: string;
  readonly detectedMaskedAccount: string | null;
  readonly totalRows: number;
  readonly validRows: readonly NormalizedSettlementReportRow[];
  readonly rejectedRows: readonly RejectedSettlementReportRow[];
}

/**
 * Masks any bank or wallet account identifier before persistence so full account numbers never
 * enter the settlement reconciliation tables (`CHECK (... ~ '^•+[0-9A-Za-z]{0,4}$')`).
 */
export function maskBankAccountNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9A-Za-z]/g, '');
  if (!cleaned) return null;
  const last4 = cleaned.slice(-4);
  return `••••••${last4}`;
}

/**
 * Sanitizes narration strings so embedded 10-digit NUBAN account numbers (such as Monnify's
 * `<txRef>/#/<batchRef>/#/<text>/#/<bank>/#/<accountNumber>` format) are masked while preserving
 * non-account 20–36 digit NIP session IDs and references.
 */
export function sanitizeNarrationMaskingAccounts(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const collapsed = String(raw)
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  if (!collapsed) return null;
  // Mask standalone 10-digit NUBAN numbers without corrupting longer 20-36 digit NIP session IDs
  const masked = collapsed.replace(/(?<![0-9A-Za-z])(\d{6})(\d{4})(?![0-9A-Za-z])/g, '••••••$2');
  return masked.slice(0, 500);
}

/**
 * Converts a major-unit decimal string or finite number (e.g. "10500.50") into integer minor units ("1050050").
 * Rejects scientific notation, NaN, >2 decimal places, or negative figures unless `allowNegative` is set.
 */
export function majorDecimalToMinor(
  raw: unknown,
  options: { allowNegative?: boolean } = {},
): string | null {
  if (raw === null || raw === undefined) return null;
  const text =
    typeof raw === 'number'
      ? Number.isFinite(raw)
        ? raw.toFixed(2)
        : ''
      : typeof raw === 'string'
        ? raw
            .trim()
            .replace(/^(-)?(?:NGN|₦)\s*/i, '$1')
            .replace(/,/g, '')
        : '';
  if (!text) return null;
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match || !match[2]) return null;
  const negative = Boolean(match[1]);
  if (negative && !options.allowNegative) return null;
  const whole = BigInt(match[2]);
  const frac = BigInt((match[3] ?? '').padEnd(2, '0'));
  const total = whole * 100n + frac;
  if (negative && total > 0n) return `-${total.toString()}`;
  return total.toString();
}

export function integerMinorString(
  raw: unknown,
  options: { allowNegative?: boolean } = {},
): string | null {
  if (raw === null || raw === undefined) return null;
  const text =
    typeof raw === 'string'
      ? raw.trim()
      : typeof raw === 'number' || typeof raw === 'bigint'
        ? String(raw).trim()
        : '';
  const pattern = options.allowNegative ? /^-?\d{1,19}$/ : /^\d{1,19}$/;
  if (!pattern.test(text)) return null;
  return BigInt(text).toString();
}

export function sha256Hex(material: string): string {
  return createHash('sha256').update(material).digest('hex');
}

export function computeRowFingerprint(input: {
  providerKey: string;
  reportType: SettlementReportType;
  direction: SettlementRowDirection;
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
  providerStatus: string;
  occurredAt: string | null;
}): string {
  return sha256Hex(
    JSON.stringify([
      input.providerKey,
      input.reportType,
      input.direction,
      input.providerTransactionReference ?? '',
      input.platformReference ?? '',
      input.paymentReference ?? '',
      input.settlementReference ?? '',
      input.payoutReference ?? '',
      input.nipSessionId ?? '',
      input.refundOrDisputeReference ?? '',
      input.currency,
      input.grossAmountMinor,
      input.providerFeeMinor,
      input.netAmountMinor,
      input.providerStatus,
      input.occurredAt ?? '',
    ]),
  );
}
