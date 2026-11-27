import { BadRequestException } from '@nestjs/common';

import {
  computeRowFingerprint,
  integerMinorString,
  majorDecimalToMinor,
  maskBankAccountNumber,
  sanitizeNarrationMaskingAccounts,
  type FormatVerificationStatus,
  type NormalizedSettlementReportRow,
  type ParsedSettlementReport,
  type RejectedSettlementReportRow,
  type SettlementFileFormat,
  type SettlementReportFormatDescriptor,
  type SettlementReportType,
  type SettlementRowDirection,
  type SettlementUnderlyingCollectionItem,
} from '../settlement-reconciliation.types';
import { detectFileFormat, parseCsvTable } from './csv-parser';
import type {
  ParseSettlementReportInput,
  SettlementReportProviderAdapter,
} from './settlement-report-adapter.interface';

type AnyRecord = Record<string, unknown>;

const MONNIFY_KEY = 'MONNIFY';
const NIP_SESSION_ID = /^\d{20,36}$/;

const MONNIFY_FORMAT_DESCRIPTORS: readonly SettlementReportFormatDescriptor[] = [
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'COLLECTIONS',
    fileFormat: 'JSON',
    supported: true,
    verificationStatus: 'VERIFIED_OFFICIAL_API_JSON',
    documentedSource:
      'Monnify API GET /api/v1/merchant/transactions/search, GET /api/v2/merchant/transactions/query & SUCCESSFUL_TRANSACTION webhook',
    missingSampleNeeded: null,
    note: 'Verified against official Monnify API/webhook JSON schemas (transactionReference, paymentReference, amountPaid, settlementAmount, fee, paidOn, paymentStatus, accountDetails/accountPayments).',
  },
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'COLLECTIONS',
    fileFormat: 'CSV',
    supported: true,
    verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
    documentedSource: 'Monnify Knowledge Base: Dashboard → Transactions → Export CSV',
    missingSampleNeeded:
      'Redacted Monnify Dashboard Collections CSV export (Dashboard → Transactions → Export CSV)',
    note: 'UNVERIFIED exact CSV header layout: Monnify public docs publish the export path and JSON fields, not exact CSV header names. Canonical/alias CSV columns are accepted on synthetic/redacted fixtures.',
  },
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'PAYOUTS',
    fileFormat: 'JSON',
    supported: true,
    verificationStatus: 'VERIFIED_OFFICIAL_API_JSON',
    documentedSource:
      'Monnify API GET /api/v2/disbursements/search-transactions, GET /api/v2/disbursements/single/summary & SUCCESSFUL/FAILED/REVERSED_DISBURSEMENT webhooks',
    missingSampleNeeded: null,
    note: 'Verified against official Monnify disbursement JSON schemas (reference, transactionReference, amount, fee, status, dateCreated/completedOn, destinationAccountNumber, destinationBankCode, 30-digit NIP sessionId).',
  },
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'PAYOUTS',
    fileFormat: 'CSV',
    supported: true,
    verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
    documentedSource: 'Monnify Knowledge Base: Dashboard → Transfers → Export CSV',
    missingSampleNeeded:
      'Redacted Monnify Dashboard Payouts/Transfers CSV export (Dashboard → Transfers → Export CSV)',
    note: 'UNVERIFIED exact CSV header layout: exact Monnify Transfers CSV header names require a redacted dashboard export.',
  },
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'SETTLEMENTS',
    fileFormat: 'JSON',
    supported: true,
    verificationStatus: 'VERIFIED_OFFICIAL_API_JSON',
    documentedSource:
      'Monnify API GET /api/v1/settlement-detail, GET /api/v1/transactions/find-by-settlement-reference & SETTLEMENT webhook',
    missingSampleNeeded: null,
    note: 'Verified against official Monnify settlement JSON schemas (settlementReference, payoutReference, settledDate, settlementAmount, settlementFee/incurredFee, destinationAccountNumber, underlying transactions[]).',
  },
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'SETTLEMENTS',
    fileFormat: 'CSV',
    supported: true,
    verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
    documentedSource:
      'Monnify Knowledge Base: Dashboard → Settlement → Export Settlements → select start & end date → Export Transaction',
    missingSampleNeeded:
      'Redacted Monnify Dashboard Settlements CSV export (Dashboard → Settlement → Export Settlements → Export Transaction)',
    note: 'UNVERIFIED exact CSV header layout: exact Monnify Settlements CSV header names require a redacted dashboard export.',
  },
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'WALLET_STATEMENT',
    fileFormat: 'JSON',
    supported: true,
    verificationStatus: 'VERIFIED_OFFICIAL_API_JSON',
    documentedSource: 'Monnify API GET /api/v1/disbursements/wallet/{accountNumber}/statement',
    missingSampleNeeded: null,
    note: 'Verified against official Monnify Wallet Statement API JSON schema (walletTransactionReference, monnifyTransactionReference, availableBalanceBefore/After, amount, transactionDate, transactionType, narration <txRef>/#/<batchRef>/#/<text>/#/<bank>/#/<acct>).',
  },
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'WALLET_STATEMENT',
    fileFormat: 'CSV',
    supported: true,
    verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
    documentedSource: 'Monnify Knowledge Base: Dashboard → Balances → Download Statement',
    missingSampleNeeded:
      'Redacted Monnify Dashboard Full Wallet Statement CSV export (Dashboard → Balances → Download Statement)',
    note: 'UNVERIFIED exact CSV header layout: needed when merchant settlement destination is Monnify Wallet.',
  },
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'BANK_STATEMENT',
    fileFormat: 'CSV',
    supported: true,
    verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
    documentedSource: 'External Nigerian commercial bank / Moniepoint corporate account statement',
    missingSampleNeeded:
      'Redacted corporate settlement bank statement CSV from the designated settlement bank account (when settlement destination policy selects Bank Account instead of Monnify Wallet)',
    note: 'UNVERIFIED bank statement CSV layout: merchant settlement destination policy (Monnify Wallet vs commercial Bank Account) and exact bank CSV columns are pending confirmation.',
  },
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'BANK_STATEMENT',
    fileFormat: 'JSON',
    supported: true,
    verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
    documentedSource: 'Normalized settlement bank statement feed (synthetic/redacted)',
    missingSampleNeeded:
      'Redacted corporate settlement bank statement export from the designated settlement bank account',
    note: 'UNVERIFIED bank statement layout: accepted for synthetic/redacted statement-matching verification.',
  },
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'REFUNDS_DISPUTES',
    fileFormat: 'JSON',
    supported: true,
    verificationStatus: 'VERIFIED_OFFICIAL_API_JSON',
    documentedSource:
      'Monnify API GET /api/v1/refunds, GET /api/v1/refunds/{refundReference} & SUCCESSFUL_REFUND / FAILED_REFUND webhooks (disputes/chargebacks/liens are email-notified in Monnify)',
    missingSampleNeeded:
      'Redacted Monnify Chargeback/Fraud Team dispute email + corresponding wallet lien/debit statement sample for non-refund dispute events',
    note: 'Voluntary bank-transfer refund JSON fields are verified via official API/webhook docs; card chargeback and fraud recall/lien events have no public Monnify webhook and are marked UNVERIFIED when dispute-type rows are imported.',
  },
  {
    providerKey: MONNIFY_KEY,
    providerDisplayName: 'Monnify',
    reportType: 'REFUNDS_DISPUTES',
    fileFormat: 'CSV',
    supported: true,
    verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
    documentedSource: 'Monnify Refunds / Chargeback & Fraud Team dispute log CSV',
    missingSampleNeeded:
      'Redacted Monnify Refunds export and Chargeback/Fraud Team dispute log CSV sample',
    note: 'UNVERIFIED exact CSV header layout.',
  },
];

function pickString(record: AnyRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const val = record[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
      return String(val);
    }
  }
  return null;
}

function parseIsoTimestamp(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}+01:00`
    : /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? `${trimmed}T00:00:00+01:00`
      : trimmed;
  const ts = Date.parse(normalized);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function asScalarText(val: unknown): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
    return String(val);
  }
  return '';
}

function resolveMinorAmount(
  record: AnyRecord,
  minorKeys: readonly string[],
  majorKeys: readonly string[],
  options: { allowNegative?: boolean } = {},
): string | null {
  for (const key of minorKeys) {
    if (record[key] !== undefined && record[key] !== null && asScalarText(record[key]).trim() !== '') {
      return integerMinorString(record[key], options);
    }
  }
  for (const key of majorKeys) {
    if (record[key] !== undefined && record[key] !== null && asScalarText(record[key]).trim() !== '') {
      return majorDecimalToMinor(record[key], options);
    }
  }
  return null;
}

function sanitizePreview(record: AnyRecord): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    if (rawValue === null || rawValue === undefined) {
      out[key] = null;
      continue;
    }
    const lower = key.toLowerCase();
    if (
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('token') ||
      lower.includes('bvn') ||
      lower.includes('nin')
    ) {
      continue;
    }
    if (lower.includes('account') && lower.includes('number')) {
      out[key] = maskBankAccountNumber(asScalarText(rawValue));
      continue;
    }
    if (lower.includes('email')) {
      out[key] = '[REDACTED_EMAIL]';
      continue;
    }
    const str = typeof rawValue === 'object' ? '[OBJECT]' : asScalarText(rawValue);
    out[key] = sanitizeNarrationMaskingAccounts(str)?.slice(0, 120) ?? null;
  }
  return out;
}

export class MonnifySettlementReportAdapter implements SettlementReportProviderAdapter {
  readonly providerKey = MONNIFY_KEY;
  readonly displayName = 'Monnify';
  readonly formatDescriptors = MONNIFY_FORMAT_DESCRIPTORS;

  supports(reportType: SettlementReportType, fileFormat?: SettlementFileFormat): boolean {
    return this.formatDescriptors.some(
      (item) =>
        item.reportType === reportType &&
        item.supported &&
        (fileFormat === undefined || item.fileFormat === fileFormat),
    );
  }

  parse(input: ParseSettlementReportInput): ParsedSettlementReport {
    if (!input.content || !input.content.trim()) {
      throw new BadRequestException('Report content cannot be empty');
    }
    const fileFormat = detectFileFormat(input.fileName, input.content);
    const descriptor = this.formatDescriptors.find(
      (item) => item.reportType === input.reportType && item.fileFormat === fileFormat,
    );
    if (!descriptor || !descriptor.supported) {
      throw new BadRequestException(
        `Monnify adapter does not support ${input.reportType} in ${fileFormat} format`,
      );
    }

    const rawRecords =
      fileFormat === 'JSON'
        ? this.extractJsonRecords(input.reportType, input.content)
        : this.extractCsvRecords(input.content);

    const validRows: NormalizedSettlementReportRow[] = [];
    const rejectedRows: RejectedSettlementReportRow[] = [];
    let detectedMaskedAccount: string | null = null;
    let currency = (input.defaultCurrency ?? 'NGN').trim().toUpperCase();
    let sawDisputeWithoutOfficialSchema = false;

    for (const { rowNumber, record } of rawRecords) {
      const result = this.normalizeRow(rowNumber, input.reportType, record, currency);
      if (!result.ok) {
        rejectedRows.push({
          rowNumber,
          reasonCode: result.reasonCode,
          message: result.message,
          sanitizedPreview: sanitizePreview(record),
        });
        continue;
      }
      validRows.push(result.row);
      currency = result.row.currency;
      if (!detectedMaskedAccount && result.row.maskedDestinationAccount) {
        detectedMaskedAccount = result.row.maskedDestinationAccount;
      }
      if (
        input.reportType === 'REFUNDS_DISPUTES' &&
        result.row.normalizedAttributes.eventKind !== 'VOLUNTARY_REFUND'
      ) {
        sawDisputeWithoutOfficialSchema = true;
      }
    }

    const verificationStatus: FormatVerificationStatus =
      sawDisputeWithoutOfficialSchema
        ? 'UNVERIFIED_MISSING_REDACTED_EXPORT'
        : descriptor.verificationStatus;

    return {
      providerKey: this.providerKey,
      reportType: input.reportType,
      fileFormat,
      verificationStatus,
      verificationNote: descriptor.note,
      missingSampleNeeded: descriptor.missingSampleNeeded,
      currency,
      detectedMaskedAccount,
      totalRows: rawRecords.length,
      validRows,
      rejectedRows,
    };
  }

  private extractJsonRecords(
    reportType: SettlementReportType,
    content: string,
  ): Array<{ rowNumber: number; record: AnyRecord }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new BadRequestException('Malformed JSON report file');
    }

    let items: unknown[] | null = null;
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as AnyRecord;
      if (Array.isArray(obj.responseBody)) {
        items = obj.responseBody;
      } else {
        const responseBody =
          obj.responseBody && typeof obj.responseBody === 'object'
            ? (obj.responseBody as AnyRecord)
            : obj;
        if (Array.isArray(responseBody.content)) {
          items = responseBody.content;
        } else if (Array.isArray(responseBody.rows)) {
          items = responseBody.rows;
        } else if (Array.isArray(responseBody.settlements)) {
          items = responseBody.settlements;
        } else if (Array.isArray(responseBody.transactions) && reportType !== 'SETTLEMENTS') {
          items = responseBody.transactions;
        } else if (obj.eventData && typeof obj.eventData === 'object') {
          items = [obj.eventData];
        } else if (responseBody !== obj) {
          items = [responseBody];
        } else {
          items = [obj];
        }
      }
    }

    if (!items) {
      throw new BadRequestException('JSON report must contain an array or Monnify responseBody');
    }

    return items.map((entry, idx) => ({
      rowNumber: idx + 1,
      record: entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as AnyRecord) : {},
    }));
  }

  private extractCsvRecords(content: string): Array<{ rowNumber: number; record: AnyRecord }> {
    let table;
    try {
      table = parseCsvTable(content);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Malformed CSV report file',
      );
    }
    if (table.headers.length === 0) {
      throw new BadRequestException('CSV report has no header row');
    }
    return table.rows.map((row) => ({
      rowNumber: row.rowNumber,
      record: { ...row.values },
    }));
  }

  private normalizeRow(
    rowNumber: number,
    reportType: SettlementReportType,
    record: AnyRecord,
    defaultCurrency: string,
  ):
    | { ok: true; row: NormalizedSettlementReportRow }
    | { ok: false; reasonCode: string; message: string } {
    switch (reportType) {
      case 'COLLECTIONS':
        return this.normalizeCollectionRow(rowNumber, record, defaultCurrency);
      case 'PAYOUTS':
        return this.normalizePayoutRow(rowNumber, record, defaultCurrency);
      case 'SETTLEMENTS':
        return this.normalizeSettlementRow(rowNumber, record, defaultCurrency);
      case 'WALLET_STATEMENT':
      case 'BANK_STATEMENT':
        return this.normalizeStatementRow(rowNumber, reportType, record, defaultCurrency);
      case 'REFUNDS_DISPUTES':
        return this.normalizeRefundDisputeRow(rowNumber, record, defaultCurrency);
    }
  }

  private normalizeCollectionRow(
    rowNumber: number,
    record: AnyRecord,
    defaultCurrency: string,
  ):
    | { ok: true; row: NormalizedSettlementReportRow }
    | { ok: false; reasonCode: string; message: string } {
    const txRef = pickString(record, [
      'transactionReference',
      'transaction_reference',
      'monnifyTransactionReference',
      'provider_transaction_reference',
    ]);
    const paymentRef = pickString(record, [
      'paymentReference',
      'payment_reference',
      'accountReference',
      'account_reference',
    ]);
    const product =
      record.product && typeof record.product === 'object'
        ? (record.product as AnyRecord)
        : null;
    const productRef = product ? pickString(product, ['reference']) : null;
    const platformRef = pickString(record, [
      'businessReference',
      'business_reference',
      'platformReference',
      'platform_reference',
      'merchantReference',
      'merchant_reference',
    ]);

    if (!txRef && !paymentRef && !platformRef) {
      return {
        ok: false,
        reasonCode: 'MISSING_REFERENCE',
        message: 'Collection row is missing transactionReference, paymentReference, and platformReference.',
      };
    }

    const currency = (
      pickString(record, ['currency', 'currencyCode', 'currency_code']) ?? defaultCurrency
    ).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      return { ok: false, reasonCode: 'INVALID_CURRENCY', message: `Invalid currency "${currency}".` };
    }

    const grossMinor = resolveMinorAmount(
      record,
      ['grossAmountMinor', 'gross_amount_minor', 'amountPaidMinor', 'amount_paid_minor'],
      ['amountPaid', 'amount_paid', 'amount', 'totalPayable', 'total_payable'],
    );
    if (!grossMinor || BigInt(grossMinor) <= 0n) {
      return {
        ok: false,
        reasonCode: 'INVALID_AMOUNT',
        message: 'Collection row must have a positive amountPaid / grossAmount.',
      };
    }

    const explicitSettlementMinor = resolveMinorAmount(
      record,
      ['settlementAmountMinor', 'settlement_amount_minor'],
      ['settlementAmount', 'settlement_amount', 'netAmount', 'net_amount'],
    );
    const explicitFeeMinor = resolveMinorAmount(
      record,
      ['providerFeeMinor', 'provider_fee_minor', 'feeMinor', 'fee_minor'],
      ['fee', 'providerFee', 'provider_fee', 'transactionFee', 'transaction_fee'],
    );

    const gross = BigInt(grossMinor);
    let fee: bigint;
    let net: bigint;
    if (explicitFeeMinor !== null && explicitSettlementMinor !== null) {
      fee = BigInt(explicitFeeMinor);
      net = BigInt(explicitSettlementMinor);
      if (fee < 0n || net < 0n || fee + net !== gross) {
        return {
          ok: false,
          reasonCode: 'AMOUNT_BREAKDOWN_MISMATCH',
          message: `Collection gross (${gross}) does not equal fee (${fee}) + settlementAmount (${net}).`,
        };
      }
    } else if (explicitSettlementMinor !== null) {
      net = BigInt(explicitSettlementMinor);
      if (net < 0n || net > gross) {
        return {
          ok: false,
          reasonCode: 'INVALID_SETTLEMENT_AMOUNT',
          message: 'Collection settlementAmount cannot exceed amountPaid or be negative.',
        };
      }
      fee = gross - net;
    } else if (explicitFeeMinor !== null) {
      fee = BigInt(explicitFeeMinor);
      if (fee < 0n || fee > gross) {
        return {
          ok: false,
          reasonCode: 'INVALID_FEE',
          message: 'Collection fee cannot exceed amountPaid or be negative.',
        };
      }
      net = gross - fee;
    } else {
      fee = 0n;
      net = gross;
    }

    const accountDetails =
      record.accountDetails && typeof record.accountDetails === 'object'
        ? (record.accountDetails as AnyRecord)
        : Array.isArray(record.accountPayments) &&
            record.accountPayments[0] &&
            typeof record.accountPayments[0] === 'object'
          ? (record.accountPayments[0] as AnyRecord)
          : null;
    const destInfo =
      record.destinationAccountInformation &&
      typeof record.destinationAccountInformation === 'object'
        ? (record.destinationAccountInformation as AnyRecord)
        : null;

    const rawNipSession =
      pickString(record, ['sessionId', 'session_id', 'nipSessionId', 'nip_session_id']) ??
      (accountDetails ? pickString(accountDetails, ['sessionId', 'session_id']) : null);
    if (rawNipSession && !NIP_SESSION_ID.test(rawNipSession)) {
      return {
        ok: false,
        reasonCode: 'INVALID_NIP_SESSION_ID',
        message: 'NIP sessionId must be a 20–36 digit numeric identifier.',
      };
    }

    const rawPaidOn = pickString(record, [
      'paidOn',
      'paid_on',
      'completedOn',
      'completed_on',
      'createdOn',
      'created_on',
      'transaction_date',
      'date',
    ]);
    const occurredAt = parseIsoTimestamp(rawPaidOn);
    if (rawPaidOn && !occurredAt) {
      return {
        ok: false,
        reasonCode: 'INVALID_TIMESTAMP',
        message: `Unparseable collection timestamp "${rawPaidOn}".`,
      };
    }

    const status = (
      pickString(record, ['paymentStatus', 'payment_status', 'status']) ?? 'UNKNOWN'
    ).toUpperCase();
    const settlementRef = pickString(record, ['settlementReference', 'settlement_reference']);
    const maskedCounterparty = maskBankAccountNumber(
      accountDetails
        ? pickString(accountDetails, ['accountNumber', 'account_number'])
        : pickString(record, ['payerAccountNumber', 'payer_account_number', 'source_account_number']),
    );
    const maskedDestination = maskBankAccountNumber(
      destInfo
        ? pickString(destInfo, ['accountNumber', 'account_number'])
        : pickString(record, [
            'destinationAccountNumber',
            'destination_account_number',
            'receivingAccountNumber',
            'receiving_account_number',
          ]),
    );
    const bankCode =
      (destInfo ? pickString(destInfo, ['bankCode', 'bank_code']) : null) ??
      (accountDetails ? pickString(accountDetails, ['bankCode', 'bank_code']) : null) ??
      pickString(record, ['destinationBankCode', 'destination_bank_code', 'bank_code']);

    const direction: SettlementRowDirection = 'INBOUND';
    const effectivePaymentRef = paymentRef ?? productRef;
    const narration = sanitizeNarrationMaskingAccounts(
      pickString(record, ['paymentDescription', 'payment_description', 'narration', 'description']),
    );

    const row: NormalizedSettlementReportRow = {
      rowNumber,
      direction,
      providerTransactionReference: txRef,
      platformReference: platformRef,
      paymentReference: effectivePaymentRef,
      settlementReference: settlementRef,
      payoutReference: null,
      nipSessionId: rawNipSession,
      refundOrDisputeReference: null,
      currency,
      grossAmountMinor: gross.toString(),
      providerFeeMinor: fee.toString(),
      netAmountMinor: net.toString(),
      runningBalanceAfterMinor: null,
      providerStatus: status,
      occurredAt,
      settledAt: parseIsoTimestamp(pickString(record, ['settledDate', 'settled_date'])),
      maskedCounterpartyAccount: maskedCounterparty,
      maskedDestinationAccount: maskedDestination,
      counterpartyBankCode: bankCode,
      narration,
      underlyingItems: [],
      normalizedAttributes: {
        paymentMethod: pickString(record, ['paymentMethod', 'payment_method']),
        productType: product ? pickString(product, ['type']) : null,
      },
      rowFingerprint: computeRowFingerprint({
        providerKey: MONNIFY_KEY,
        reportType: 'COLLECTIONS',
        direction,
        providerTransactionReference: txRef,
        platformReference: platformRef,
        paymentReference: effectivePaymentRef,
        settlementReference: settlementRef,
        payoutReference: null,
        nipSessionId: rawNipSession,
        refundOrDisputeReference: null,
        currency,
        grossAmountMinor: gross.toString(),
        providerFeeMinor: fee.toString(),
        netAmountMinor: net.toString(),
        providerStatus: status,
        occurredAt,
      }),
    };
    return { ok: true, row };
  }

  private normalizePayoutRow(
    rowNumber: number,
    record: AnyRecord,
    defaultCurrency: string,
  ):
    | { ok: true; row: NormalizedSettlementReportRow }
    | { ok: false; reasonCode: string; message: string } {
    const txRef = pickString(record, [
      'transactionReference',
      'transaction_reference',
      'providerTransactionReference',
      'provider_transaction_reference',
    ]);
    const platformRef = pickString(record, [
      'reference',
      'operationReference',
      'operation_reference',
      'platformReference',
      'platform_reference',
    ]);
    const rawNipSession = pickString(record, [
      'sessionId',
      'session_id',
      'nipSessionId',
      'nip_session_id',
    ]);

    if (!txRef && !platformRef && !rawNipSession) {
      return {
        ok: false,
        reasonCode: 'MISSING_REFERENCE',
        message: 'Payout row is missing reference, transactionReference, and NIP sessionId.',
      };
    }
    if (rawNipSession && !NIP_SESSION_ID.test(rawNipSession)) {
      return {
        ok: false,
        reasonCode: 'INVALID_NIP_SESSION_ID',
        message: 'Payout NIP sessionId must be a 20–36 digit numeric identifier.',
      };
    }

    const currency = (
      pickString(record, ['currency', 'currencyCode', 'currency_code']) ?? defaultCurrency
    ).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      return { ok: false, reasonCode: 'INVALID_CURRENCY', message: `Invalid currency "${currency}".` };
    }

    const grossMinor = resolveMinorAmount(
      record,
      ['amountMinor', 'amount_minor', 'grossAmountMinor', 'gross_amount_minor'],
      ['amount', 'principalAmount', 'principal_amount'],
    );
    if (!grossMinor || BigInt(grossMinor) <= 0n) {
      return {
        ok: false,
        reasonCode: 'INVALID_AMOUNT',
        message: 'Payout row must have a positive transfer amount.',
      };
    }
    const feeMinor =
      resolveMinorAmount(
        record,
        ['feeMinor', 'fee_minor', 'providerFeeMinor', 'provider_fee_minor'],
        ['fee', 'totalFee', 'total_fee'],
      ) ?? '0';
    if (BigInt(feeMinor) < 0n) {
      return { ok: false, reasonCode: 'INVALID_FEE', message: 'Payout fee cannot be negative.' };
    }

    const rawTime = pickString(record, [
      'completedOn',
      'completed_on',
      'dateCreated',
      'date_created',
      'createdOn',
      'created_on',
      'date',
    ]);
    const occurredAt = parseIsoTimestamp(rawTime);
    if (rawTime && !occurredAt) {
      return {
        ok: false,
        reasonCode: 'INVALID_TIMESTAMP',
        message: `Unparseable payout timestamp "${rawTime}".`,
      };
    }

    const status = (pickString(record, ['status', 'transferStatus', 'transfer_status']) ?? 'UNKNOWN').toUpperCase();
    const maskedDestination = maskBankAccountNumber(
      pickString(record, [
        'destinationAccountNumber',
        'destination_account_number',
        'beneficiaryAccountNumber',
        'beneficiary_account_number',
      ]),
    );
    const maskedSource = maskBankAccountNumber(
      pickString(record, ['sourceAccountNumber', 'source_account_number']),
    );
    const bankCode = pickString(record, [
      'destinationBankCode',
      'destination_bank_code',
      'bankCode',
      'bank_code',
    ]);
    const totalDebit = (BigInt(grossMinor) + BigInt(feeMinor)).toString();
    const narration = sanitizeNarrationMaskingAccounts(
      pickString(record, ['narration', 'comment', 'transactionDescription', 'description']),
    );

    const row: NormalizedSettlementReportRow = {
      rowNumber,
      direction: 'OUTBOUND',
      providerTransactionReference: txRef,
      platformReference: platformRef,
      paymentReference: null,
      settlementReference: null,
      payoutReference: txRef,
      nipSessionId: rawNipSession,
      refundOrDisputeReference: null,
      currency,
      grossAmountMinor: grossMinor,
      providerFeeMinor: feeMinor,
      netAmountMinor: totalDebit,
      runningBalanceAfterMinor: null,
      providerStatus: status,
      occurredAt,
      settledAt: status === 'SUCCESS' || status === 'SUCCESSFUL' ? occurredAt : null,
      maskedCounterpartyAccount: maskedDestination,
      maskedDestinationAccount: maskedSource,
      counterpartyBankCode: bankCode,
      narration,
      underlyingItems: [],
      normalizedAttributes: {
        destinationBankName: pickString(record, ['destinationBankName', 'destination_bank_name']),
      },
      rowFingerprint: computeRowFingerprint({
        providerKey: MONNIFY_KEY,
        reportType: 'PAYOUTS',
        direction: 'OUTBOUND',
        providerTransactionReference: txRef,
        platformReference: platformRef,
        paymentReference: null,
        settlementReference: null,
        payoutReference: txRef,
        nipSessionId: rawNipSession,
        refundOrDisputeReference: null,
        currency,
        grossAmountMinor: grossMinor,
        providerFeeMinor: feeMinor,
        netAmountMinor: totalDebit,
        providerStatus: status,
        occurredAt,
      }),
    };
    return { ok: true, row };
  }

  private normalizeSettlementRow(
    rowNumber: number,
    record: AnyRecord,
    defaultCurrency: string,
  ):
    | { ok: true; row: NormalizedSettlementReportRow }
    | { ok: false; reasonCode: string; message: string } {
    const settlementInfo =
      record.settlementInformation && typeof record.settlementInformation === 'object'
        ? (record.settlementInformation as AnyRecord)
        : Array.isArray(record.beneficiaries) &&
            record.beneficiaries[0] &&
            typeof record.beneficiaries[0] === 'object' &&
            (record.beneficiaries[0] as AnyRecord).settlementInformation &&
            typeof (record.beneficiaries[0] as AnyRecord).settlementInformation === 'object'
          ? ((record.beneficiaries[0] as AnyRecord).settlementInformation as AnyRecord)
          : record;

    const settlementRef =
      pickString(settlementInfo, ['settlementReference', 'settlement_reference', 'reference']) ??
      pickString(record, ['settlementReference', 'settlement_reference', 'reference']);
    if (!settlementRef) {
      return {
        ok: false,
        reasonCode: 'MISSING_SETTLEMENT_REFERENCE',
        message: 'Settlement row is missing settlementReference.',
      };
    }

    const payoutRef =
      pickString(settlementInfo, ['payoutReference', 'payout_reference']) ??
      pickString(record, ['payoutReference', 'payout_reference']);

    const currency = (
      pickString(record, ['currency', 'currencyCode', 'currency_code']) ?? defaultCurrency
    ).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      return { ok: false, reasonCode: 'INVALID_CURRENCY', message: `Invalid currency "${currency}".` };
    }

    const underlyingRaw = Array.isArray(record.transactions) ? record.transactions : [];
    const underlyingItems: SettlementUnderlyingCollectionItem[] = [];
    for (const item of underlyingRaw) {
      if (!item || typeof item !== 'object') continue;
      const u = item as AnyRecord;
      const uTxRef = pickString(u, ['transactionReference', 'transaction_reference']);
      if (!uTxRef) continue;
      const uGross =
        resolveMinorAmount(
          u,
          ['grossAmountMinor', 'gross_amount_minor', 'amountPaidMinor'],
          ['amountPaid', 'amount_paid', 'amount'],
        ) ?? '0';
      const uNet =
        resolveMinorAmount(
          u,
          ['settlementAmountMinor', 'settlement_amount_minor'],
          ['settlementAmount', 'settlement_amount'],
        ) ?? uGross;
      const uFee =
        resolveMinorAmount(u, ['providerFeeMinor', 'feeMinor'], ['fee', 'providerFee']) ??
        (BigInt(uGross) - BigInt(uNet)).toString();
      underlyingItems.push({
        providerTransactionReference: uTxRef,
        paymentReference: pickString(u, ['paymentReference', 'payment_reference']),
        platformReference: pickString(u, ['businessReference', 'business_reference', 'platformReference']),
        grossAmountMinor: uGross,
        providerFeeMinor: uFee,
        netSettlementMinor: uNet,
        currency,
        paidAt: parseIsoTimestamp(pickString(u, ['paidOn', 'paid_on', 'createdOn'])),
        providerStatus: (pickString(u, ['paymentStatus', 'payment_status', 'status']) ?? 'PAID').toUpperCase(),
      });
    }

    const netMinor =
      resolveMinorAmount(
        settlementInfo,
        ['settlementAmountMinor', 'settlement_amount_minor', 'netAmountMinor', 'net_amount_minor'],
        ['settlementAmount', 'settlement_amount', 'amount', 'netSettlement'],
      ) ??
      resolveMinorAmount(
        record,
        ['settlementAmountMinor', 'settlement_amount_minor', 'netAmountMinor', 'net_amount_minor'],
        ['settlementAmount', 'settlement_amount', 'amount', 'netSettlement'],
      );
    if (!netMinor || BigInt(netMinor) <= 0n) {
      return {
        ok: false,
        reasonCode: 'INVALID_SETTLEMENT_AMOUNT',
        message: 'Settlement row must have a positive settlementAmount.',
      };
    }

    const summedGross =
      underlyingItems.length > 0
        ? underlyingItems.reduce((acc, u) => acc + BigInt(u.grossAmountMinor), 0n).toString()
        : null;
    const explicitFee =
      resolveMinorAmount(
        settlementInfo,
        ['providerFeeMinor', 'provider_fee_minor', 'settlementFeeMinor', 'settlement_fee_minor'],
        ['totalFee', 'total_fee', 'incurredFee', 'incurred_fee', 'settlementFee', 'settlement_fee', 'fee'],
      ) ??
      resolveMinorAmount(
        record,
        ['providerFeeMinor', 'provider_fee_minor', 'settlementFeeMinor', 'settlement_fee_minor'],
        ['totalFee', 'total_fee', 'incurredFee', 'incurred_fee', 'settlementFee', 'settlement_fee', 'fee'],
      );
    const explicitGross =
      resolveMinorAmount(
        record,
        ['grossAmountMinor', 'gross_amount_minor', 'totalGrossMinor'],
        ['grossAmount', 'gross_amount', 'totalCollectionAmount', 'total_collection_amount'],
      ) ?? summedGross;

    const net = BigInt(netMinor);
    let gross: bigint;
    let fee: bigint;
    if (explicitGross !== null && explicitFee !== null) {
      gross = BigInt(explicitGross);
      fee = BigInt(explicitFee);
    } else if (explicitGross !== null) {
      gross = BigInt(explicitGross);
      fee = gross >= net ? gross - net : 0n;
    } else if (explicitFee !== null) {
      fee = BigInt(explicitFee);
      gross = net + fee;
    } else {
      fee = 0n;
      gross = net;
    }

    const rawSettledAt =
      pickString(settlementInfo, ['settledDate', 'settled_date', 'completedOn', 'completed_on']) ??
      pickString(record, ['settledDate', 'settled_date', 'completedOn', 'completed_on', 'date']);
    const settledAt = parseIsoTimestamp(rawSettledAt);
    if (rawSettledAt && !settledAt) {
      return {
        ok: false,
        reasonCode: 'INVALID_TIMESTAMP',
        message: `Unparseable settlement date "${rawSettledAt}".`,
      };
    }

    const maskedDest = maskBankAccountNumber(
      pickString(settlementInfo, ['destinationAccountNumber', 'destination_account_number']) ??
        pickString(record, ['destinationAccountNumber', 'destination_account_number']),
    );
    const destBankCode =
      pickString(settlementInfo, ['destinationBankCode', 'destination_bank_code']) ??
      pickString(record, ['destinationBankCode', 'destination_bank_code']);
    const destBankName =
      pickString(settlementInfo, ['destinationBankName', 'destination_bank_name']) ??
      pickString(record, ['destinationBankName', 'destination_bank_name']);
    const status = (
      pickString(record, ['settlementStatus', 'settlement_status', 'status']) ?? 'SUCCESS'
    ).toUpperCase();
    const txCountRaw = pickString(record, ['transactionsCount', 'transactions_count', 'collection_count']);
    const reportedCount =
      txCountRaw && /^\d+$/.test(txCountRaw)
        ? Number(txCountRaw)
        : underlyingItems.length > 0
          ? underlyingItems.length
          : null;

    const singleCollectionTxRef =
      underlyingItems.length === 1
        ? underlyingItems[0]!.providerTransactionReference
        : pickString(record, ['transactionReference', 'transaction_reference']);

    const row: NormalizedSettlementReportRow = {
      rowNumber,
      direction: 'SETTLEMENT',
      providerTransactionReference: singleCollectionTxRef,
      platformReference: null,
      paymentReference: null,
      settlementReference: settlementRef,
      payoutReference: payoutRef,
      nipSessionId: null,
      refundOrDisputeReference: null,
      currency,
      grossAmountMinor: gross.toString(),
      providerFeeMinor: fee.toString(),
      netAmountMinor: net.toString(),
      runningBalanceAfterMinor: null,
      providerStatus: status,
      occurredAt: settledAt,
      settledAt,
      maskedCounterpartyAccount: null,
      maskedDestinationAccount: maskedDest,
      counterpartyBankCode: destBankCode,
      narration: sanitizeNarrationMaskingAccounts(
        pickString(record, ['narration', 'description']),
      ),
      underlyingItems,
      normalizedAttributes: {
        destinationBankName: destBankName,
        transactionsCount: reportedCount,
      },
      rowFingerprint: computeRowFingerprint({
        providerKey: MONNIFY_KEY,
        reportType: 'SETTLEMENTS',
        direction: 'SETTLEMENT',
        providerTransactionReference: singleCollectionTxRef,
        platformReference: null,
        paymentReference: null,
        settlementReference: settlementRef,
        payoutReference: payoutRef,
        nipSessionId: null,
        refundOrDisputeReference: null,
        currency,
        grossAmountMinor: gross.toString(),
        providerFeeMinor: fee.toString(),
        netAmountMinor: net.toString(),
        providerStatus: status,
        occurredAt: settledAt,
      }),
    };
    return { ok: true, row };
  }

  private normalizeStatementRow(
    rowNumber: number,
    reportType: 'WALLET_STATEMENT' | 'BANK_STATEMENT',
    record: AnyRecord,
    defaultCurrency: string,
  ):
    | { ok: true; row: NormalizedSettlementReportRow }
    | { ok: false; reasonCode: string; message: string } {
    const entryRef = pickString(record, [
      'walletTransactionReference',
      'wallet_transaction_reference',
      'statementReference',
      'statement_reference',
      'entryReference',
      'entry_reference',
      'reference',
    ]);
    const monnifyTxRef = pickString(record, [
      'monnifyTransactionReference',
      'monnify_transaction_reference',
      'transactionReference',
      'transaction_reference',
    ]);
    const rawNarration = pickString(record, ['narration', 'message', 'description', 'remarks']);
    if (!entryRef && !monnifyTxRef && !rawNarration) {
      return {
        ok: false,
        reasonCode: 'MISSING_STATEMENT_REFERENCE',
        message: 'Statement row is missing entry reference and narration.',
      };
    }

    let extractedSettlementRef = pickString(record, ['settlementReference', 'settlement_reference']);
    let extractedPayoutRef = pickString(record, ['payoutReference', 'payout_reference']);
    let extractedNarrationAccount: string | null = null;
    if (rawNarration && rawNarration.includes('/#/')) {
      const parts = rawNarration.split('/#/').map((s) => s.trim());
      if (!extractedPayoutRef && parts[0]) extractedPayoutRef = parts[0];
      if (!extractedSettlementRef && parts[1]) extractedSettlementRef = parts[1];
      if (parts[4]) extractedNarrationAccount = parts[4];
    }

    const txTypeRaw = (
      pickString(record, ['transactionType', 'transaction_type', 'entryType', 'entry_type', 'type']) ??
      ''
    ).toUpperCase();
    const creditMajor = pickString(record, ['credit', 'creditAmount', 'credit_amount']);
    const debitMajor = pickString(record, ['debit', 'debitAmount', 'debit_amount']);

    let direction: 'STATEMENT_CREDIT' | 'STATEMENT_DEBIT';
    let amountMinor: string | null = null;
    if (txTypeRaw === 'CREDIT' || txTypeRaw === 'CR') {
      direction = 'STATEMENT_CREDIT';
      amountMinor = resolveMinorAmount(
        record,
        ['amountMinor', 'amount_minor', 'creditMinor', 'credit_minor'],
        ['amount', 'credit', 'creditAmount', 'credit_amount'],
      );
    } else if (txTypeRaw === 'DEBIT' || txTypeRaw === 'DR') {
      direction = 'STATEMENT_DEBIT';
      amountMinor = resolveMinorAmount(
        record,
        ['amountMinor', 'amount_minor', 'debitMinor', 'debit_minor'],
        ['amount', 'debit', 'debitAmount', 'debit_amount'],
      );
    } else if (creditMajor && majorDecimalToMinor(creditMajor) !== '0') {
      direction = 'STATEMENT_CREDIT';
      amountMinor = majorDecimalToMinor(creditMajor);
    } else if (debitMajor && majorDecimalToMinor(debitMajor) !== '0') {
      direction = 'STATEMENT_DEBIT';
      amountMinor = majorDecimalToMinor(debitMajor);
    } else {
      return {
        ok: false,
        reasonCode: 'INVALID_STATEMENT_DIRECTION',
        message: 'Statement row must specify transactionType (CREDIT/DEBIT) or positive credit/debit column.',
      };
    }

    if (!amountMinor || BigInt(amountMinor) <= 0n) {
      return {
        ok: false,
        reasonCode: 'INVALID_AMOUNT',
        message: 'Statement row must have a positive transaction amount.',
      };
    }

    const balanceAfterMinor = resolveMinorAmount(
      record,
      ['availableBalanceAfterMinor', 'available_balance_after_minor', 'balanceAfterMinor'],
      ['availableBalanceAfter', 'available_balance_after', 'balanceAfter', 'balance', 'closing_balance'],
      { allowNegative: true },
    );

    const currency = (
      pickString(record, ['currency', 'currencyCode', 'currency_code']) ?? defaultCurrency
    ).toUpperCase();
    const rawDate = pickString(record, [
      'transactionDate',
      'transaction_date',
      'valueDate',
      'value_date',
      'postedDate',
      'posted_date',
      'date',
    ]);
    const occurredAt = parseIsoTimestamp(rawDate);
    if (rawDate && !occurredAt) {
      return {
        ok: false,
        reasonCode: 'INVALID_TIMESTAMP',
        message: `Unparseable statement date "${rawDate}".`,
      };
    }

    const status = (pickString(record, ['status']) ?? 'COMPLETED').toUpperCase();
    const maskedAccount = maskBankAccountNumber(
      pickString(record, ['accountNumber', 'account_number', 'walletAccountNumber', 'wallet_account_number']) ??
        extractedNarrationAccount,
    );
    const sanitizedNarration = sanitizeNarrationMaskingAccounts(rawNarration);

    const row: NormalizedSettlementReportRow = {
      rowNumber,
      direction,
      providerTransactionReference: monnifyTxRef ?? entryRef,
      platformReference: entryRef,
      paymentReference: null,
      settlementReference: extractedSettlementRef,
      payoutReference: extractedPayoutRef,
      nipSessionId: pickString(record, ['sessionId', 'session_id', 'nipSessionId', 'nip_session_id']),
      refundOrDisputeReference: null,
      currency,
      grossAmountMinor: amountMinor,
      providerFeeMinor: '0',
      netAmountMinor: amountMinor,
      runningBalanceAfterMinor: balanceAfterMinor,
      providerStatus: status,
      occurredAt,
      settledAt: occurredAt,
      maskedCounterpartyAccount: null,
      maskedDestinationAccount: maskedAccount,
      counterpartyBankCode: pickString(record, ['bankCode', 'bank_code']),
      narration: sanitizedNarration,
      underlyingItems: [],
      normalizedAttributes: {
        statementSource: reportType,
      },
      rowFingerprint: computeRowFingerprint({
        providerKey: MONNIFY_KEY,
        reportType,
        direction,
        providerTransactionReference: monnifyTxRef ?? entryRef,
        platformReference: entryRef,
        paymentReference: null,
        settlementReference: extractedSettlementRef,
        payoutReference: extractedPayoutRef,
        nipSessionId: null,
        refundOrDisputeReference: null,
        currency,
        grossAmountMinor: amountMinor,
        providerFeeMinor: '0',
        netAmountMinor: amountMinor,
        providerStatus: status,
        occurredAt,
      }),
    };
    return { ok: true, row };
  }

  private normalizeRefundDisputeRow(
    rowNumber: number,
    record: AnyRecord,
    defaultCurrency: string,
  ):
    | { ok: true; row: NormalizedSettlementReportRow }
    | { ok: false; reasonCode: string; message: string } {
    const refundOrDisputeRef = pickString(record, [
      'refundReference',
      'refund_reference',
      'disputeReference',
      'dispute_reference',
      'chargebackReference',
      'chargeback_reference',
      'caseReference',
      'case_reference',
      'reference',
    ]);
    const originalTxRef = pickString(record, [
      'transactionReference',
      'transaction_reference',
      'originalTransactionReference',
      'original_transaction_reference',
    ]);
    const platformRef = pickString(record, [
      'businessReference',
      'business_reference',
      'platformReference',
      'platform_reference',
      'operationReference',
      'operation_reference',
    ]);
    const paymentRef = pickString(record, ['paymentReference', 'payment_reference']);

    if (!refundOrDisputeRef && !originalTxRef && !platformRef) {
      return {
        ok: false,
        reasonCode: 'MISSING_RETURN_REFERENCE',
        message: 'Refund/dispute row must include refundReference/disputeReference or original transactionReference.',
      };
    }

    const currency = (
      pickString(record, ['currency', 'currencyCode', 'currency_code']) ?? defaultCurrency
    ).toUpperCase();
    const amountMinor = resolveMinorAmount(
      record,
      ['refundAmountMinor', 'refund_amount_minor', 'amountMinor', 'amount_minor'],
      ['refundAmount', 'refund_amount', 'disputedAmount', 'disputed_amount', 'amount'],
    );
    if (!amountMinor || BigInt(amountMinor) <= 0n) {
      return {
        ok: false,
        reasonCode: 'INVALID_AMOUNT',
        message: 'Refund/dispute row must carry a positive refundAmount / disputedAmount.',
      };
    }

    const feeMinor =
      resolveMinorAmount(
        record,
        ['feeMinor', 'fee_minor', 'refundFeeMinor', 'refund_fee_minor'],
        ['fee', 'refundFee', 'refund_fee'],
      ) ?? '0';

    const rawKind = (
      pickString(record, ['eventKind', 'event_kind', 'type', 'refundType', 'refund_type']) ??
      'VOLUNTARY_REFUND'
    ).toUpperCase();
    const eventKind =
      rawKind.includes('CHARGEBACK') || rawKind.includes('LIEN')
        ? 'CHARGEBACK_OR_LIEN'
        : rawKind.includes('REVERSAL') || rawKind.includes('RECALL')
          ? 'REVERSAL_OR_RECALL'
          : rawKind.includes('DISPUTE')
            ? 'DISPUTE'
            : 'VOLUNTARY_REFUND';

    const status = (
      pickString(record, ['refundStatus', 'refund_status', 'disputeStatus', 'dispute_status', 'status']) ??
      'PENDING'
    ).toUpperCase();

    const rawDate = pickString(record, [
      'completedOn',
      'completed_on',
      'createdOn',
      'created_on',
      'date',
    ]);
    const occurredAt = parseIsoTimestamp(rawDate);
    if (rawDate && !occurredAt) {
      return {
        ok: false,
        reasonCode: 'INVALID_TIMESTAMP',
        message: `Unparseable refund/dispute date "${rawDate}".`,
      };
    }

    const maskedDest = maskBankAccountNumber(
      pickString(record, ['destinationAccountNumber', 'destination_account_number']),
    );
    const reason = sanitizeNarrationMaskingAccounts(
      pickString(record, ['refundReason', 'refund_reason', 'customerNote', 'reason', 'narration']),
    );

    const row: NormalizedSettlementReportRow = {
      rowNumber,
      direction: 'RETURN_EVENT',
      providerTransactionReference: originalTxRef,
      platformReference: platformRef,
      paymentReference: paymentRef,
      settlementReference: null,
      payoutReference: null,
      nipSessionId: pickString(record, ['sessionId', 'session_id', 'nipSessionId', 'nip_session_id']),
      refundOrDisputeReference: refundOrDisputeRef,
      currency,
      grossAmountMinor: amountMinor,
      providerFeeMinor: feeMinor,
      netAmountMinor: (BigInt(amountMinor) + BigInt(feeMinor)).toString(),
      runningBalanceAfterMinor: null,
      providerStatus: status,
      occurredAt,
      settledAt: status === 'COMPLETED' || status === 'SUCCESS' ? occurredAt : null,
      maskedCounterpartyAccount: maskedDest,
      maskedDestinationAccount: null,
      counterpartyBankCode: pickString(record, ['destinationBankCode', 'destination_bank_code']),
      narration: reason,
      underlyingItems: [],
      normalizedAttributes: {
        eventKind,
        refundStrategy: pickString(record, ['refundType', 'refund_type']),
      },
      rowFingerprint: computeRowFingerprint({
        providerKey: MONNIFY_KEY,
        reportType: 'REFUNDS_DISPUTES',
        direction: 'RETURN_EVENT',
        providerTransactionReference: originalTxRef,
        platformReference: platformRef,
        paymentReference: paymentRef,
        settlementReference: null,
        payoutReference: null,
        nipSessionId: null,
        refundOrDisputeReference: refundOrDisputeRef,
        currency,
        grossAmountMinor: amountMinor,
        providerFeeMinor: feeMinor,
        netAmountMinor: (BigInt(amountMinor) + BigInt(feeMinor)).toString(),
        providerStatus: status,
        occurredAt,
      }),
    };
    return { ok: true, row };
  }
}
