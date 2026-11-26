import type {
  DocumentFormat,
  ParseResult,
  ProviderAdapter,
  ProviderKey,
  ProviderRow,
  ReportKind,
  SettlementDestination,
} from './types';

/**
 * Monnify-specific file format adapter.
 *
 * Confirmed here means "the field names and envelope are shown in Monnify's official developer
 * documentation" (API response bodies and webhook event notifications). It does NOT mean a
 * dashboard CSV header has been verified: no redacted CSV sample was supplied, so CSV is refused
 * with the exact export required. See docs/integration/MONNIFY-SETTLEMENT-REPORT-PREVIEW.md.
 */

const EXACT_EXPORTS: Record<ReportKind, string> = {
  COLLECTIONS:
    'Monnify dashboard → Transactions → Export CSV (date range selected), redacted but retaining paymentReference, transactionReference, paymentStatus, amountPaid, totalPayable, settlementAmount, paidOn, currency, paymentMethod and sessionId where present.',
  PAYOUTS:
    'Monnify dashboard → Transfers → Export CSV (date range selected), redacted but retaining reference, transactionReference, sessionId, amount, fee, status/transactionStatus, currency, createdOn, completedOn and destinationAccountNumber/destinationBankCode.',
  SETTLEMENTS:
    'Monnify dashboard → Settlement → Export Settlements → select start and end date → Export Transaction, redacted but retaining settlementReference, settlementTime, amount, transactionsCount, destinationAccountNumber/destinationAccountName/destinationBankName/destinationBankCode and the included transaction rows.',
};

const ALL_EXACT_EXPORTS = Object.values(EXACT_EXPORTS).join(' ');

const eventKinds: Record<string, ReportKind> = {
  SUCCESSFUL_TRANSACTION: 'COLLECTIONS',
  REJECTED_PAYMENT: 'COLLECTIONS',
  SUCCESSFUL_DISBURSEMENT: 'PAYOUTS',
  FAILED_DISBURSEMENT: 'PAYOUTS',
  REVERSED_DISBURSEMENT: 'PAYOUTS',
  SETTLEMENT: 'SETTLEMENTS',
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

/** Convert documented major-unit amounts ("1234.56" or 1234.56) to integer minor units. */
export const majorToMinor = (value: unknown): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalised = String(value).replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d{1,4})?$/.test(normalised)) return undefined;
  const minor = Math.round(Number(normalised) * 100);
  return Number.isSafeInteger(minor) ? String(minor) : undefined;
};

/** Non-cryptographic content fingerprint. Duplicate detection only; never used for security. */
export const contentFingerprint = (content: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}-${content.length.toString(16)}`;
};

const sessionFrom = (raw: Record<string, unknown>): { id?: string; source?: string } => {
  const direct = text(raw.sessionId);
  if (direct) return { id: direct, source: 'sessionId' };
  for (const containerName of ['paymentSourceInformation', 'accountDetails']) {
    const container = asRecord(raw[containerName]);
    const id = container ? text(container.sessionId) : undefined;
    if (id) return { id, source: `${containerName}.sessionId` };
    const list = raw[containerName];
    if (Array.isArray(list)) {
      for (const item of list) {
        const record = asRecord(item);
        const found = record ? text(record.sessionId) : undefined;
        if (found) return { id: found, source: `${containerName}[].sessionId` };
      }
    }
  }
  const payments = raw.accountPayments;
  if (Array.isArray(payments)) {
    for (const item of payments) {
      const record = asRecord(item);
      const found = record ? text(record.sessionId) : undefined;
      if (found) return { id: found, source: 'accountPayments[].sessionId' };
    }
  }
  return {};
};

const destinationFrom = (raw: Record<string, unknown>): SettlementDestination | undefined => {
  const nested = asRecord(raw.destinationAccountInformation);
  const source = nested ?? raw;
  const destination: SettlementDestination = {
    accountNumber: text(source.destinationAccountNumber ?? source.accountNumber),
    accountName: text(source.destinationAccountName ?? source.accountName),
    bankCode: text(source.destinationBankCode ?? source.bankCode),
    bankName: text(source.destinationBankName ?? source.bankName),
  };
  return Object.values(destination).some(Boolean) ? destination : undefined;
};

const observedColumnsFor = (raw: Record<string, unknown>): string[] => {
  const names = Object.keys(raw).sort();
  const nested: string[] = [];
  for (const key of ['paymentSourceInformation', 'accountDetails', 'accountPayments', 'product']) {
    const value = raw[key];
    if (Array.isArray(value)) nested.push(`${key}[]`);
    else if (asRecord(value)) nested.push(key);
  }
  const session = sessionFrom(raw);
  if (session.source) nested.push(session.source);
  return Array.from(new Set([...names, ...nested])).sort();
};

const makeRow = (
  raw: Record<string, unknown>,
  kind: ReportKind,
  context: {
    fileName: string;
    fingerprint: string;
    format: DocumentFormat;
    rowNumber: number;
    settlementReference?: string;
    statusOverride?: string;
  },
): ProviderRow | null => {
  const amountMinor =
    majorToMinor(raw.amountPaid) ??
    majorToMinor(raw.amount) ??
    majorToMinor(raw.totalPayable) ??
    majorToMinor(raw.refundAmount);
  if (amountMinor === undefined) return null;
  const currency = text(raw.currency) ?? text(raw.currencyCode) ?? 'NGN';
  const session = sessionFrom(raw);
  const status =
    context.statusOverride ??
    text(raw.paymentStatus) ??
    text(raw.status) ??
    text(raw.transactionStatus) ??
    (kind === 'SETTLEMENTS' ? 'SETTLEMENT_COMPLETED' : 'UNKNOWN');
  const settlementReference = text(raw.settlementReference) ?? context.settlementReference;
  const providerTransactionReference = text(raw.transactionReference);
  const merchantReference = text(raw.paymentReference) ?? text(raw.reference);
  if (!providerTransactionReference && !merchantReference && !settlementReference && !session.id)
    return null;

  return {
    provider: 'MONNIFY',
    kind,
    format: context.format,
    fileName: context.fileName,
    documentFingerprint: context.fingerprint,
    rowNumber: context.rowNumber,
    observedColumns: observedColumnsFor(raw),
    providerTransactionReference,
    merchantReference,
    settlementReference,
    nipSessionId: session.id,
    nipSessionIdSource: session.source,
    amountMinor,
    settlementAmountMinor: majorToMinor(raw.settlementAmount),
    feeMinor: majorToMinor(raw.fee),
    currency,
    status,
    occurredAt: text(raw.paidOn) ?? text(raw.createdOn) ?? text(raw.settlementTime) ?? text(raw.completedOn),
    settlementDestination: destinationFrom(raw),
    raw,
  };
};

const kindFromDocument = (document: Record<string, unknown>, content: unknown[]): ReportKind | null => {
  const eventType = text(document.eventType);
  if (eventType && eventKinds[eventType]) return eventKinds[eventType];
  const has = (key: string) =>
    content.some((item) => {
      const row = asRecord(item);
      return Boolean(row && row[key] !== undefined);
    });
  if (has('settlementReference') && !has('paymentStatus')) return 'SETTLEMENTS';
  if (has('paymentStatus') || has('amountPaid')) return 'COLLECTIONS';
  if (has('status') || has('transactionStatus')) return 'PAYOUTS';
  return null;
};

const normalise = (
  fileName: string,
  documents: unknown[],
  format: DocumentFormat,
  fingerprint: string,
  kind: ReportKind,
): ParseResult => {
  const rows: ProviderRow[] = [];
  const embeddedCollections: ProviderRow[] = [];

  documents.forEach((item, index) => {
    const envelope = asRecord(item);
    if (!envelope) return;
    const body = asRecord(envelope.responseBody);
    const payload = asRecord(envelope.eventData) ?? (body && !Array.isArray(body.content) ? body : envelope);
    const contentRows = body && Array.isArray(body.content) ? body.content : [payload];
    const settlementReference = text(payload.settlementReference);
    contentRows.forEach((contentItem, contentIndex) => {
    const raw = asRecord(contentItem);
    if (!raw) return;
    const row = makeRow(raw, kind, {
      fileName,
      fingerprint,
      format,
      rowNumber: index * 1000 + contentIndex + 1,
      settlementReference,
    });
    if (row) rows.push(row);
    if (kind === 'SETTLEMENTS' && Array.isArray(raw.transactions)) {
      raw.transactions.forEach((embedded, embeddedIndex) => {
        const embeddedRaw = asRecord(embedded);
        if (!embeddedRaw) return;
        const embeddedRow = makeRow(embeddedRaw, 'COLLECTIONS', {
          fileName,
          fingerprint,
          format,
          rowNumber: index * 1000 + 100 + embeddedIndex + 1,
          settlementReference: text(embeddedRaw.settlementReference) ?? settlementReference,
          statusOverride: text(embeddedRaw.paymentStatus),
        });
        if (embeddedRow) embeddedCollections.push(embeddedRow);
      });
    }
    });
  });

  if (rows.length === 0) {
    return {
      ok: false,
      code: 'INVALID_DOCUMENT',
      message:
        'No documented Monnify rows were found. Supported inputs are documented API response bodies and webhook event notifications.',
      exactExportNeeded: ALL_EXACT_EXPORTS,
    };
  }

  return {
    ok: true,
    provider: 'MONNIFY',
    format,
    kind,
    rows,
    embeddedCollections,
    documentFingerprint: fingerprint,
    observedColumns: Array.from(new Set(rows.flatMap((row) => row.observedColumns))).sort(),
  };
};

export const monnifyAdapter: ProviderAdapter = {
  provider: 'MONNIFY',
  label: 'Monnify — documented API / webhook JSON',
  confirmedFormats: [
    'GET transaction search / find-by-settlement-reference responseBody.content[]',
    'GET disbursement search responseBody.content[]',
    'SUCCESSFUL_TRANSACTION / SUCCESSFUL_DISBURSEMENT / SETTLEMENT webhook event notifications',
  ],
  parse(fileName: string, content: string): ParseResult {
    const fingerprint = contentFingerprint(content);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      if (content.includes(',') && content.includes('\n')) {
        return {
          ok: false,
          code: 'UNVERIFIED_CSV_FORMAT',
          message:
            'CSV layout is unverified: no redacted dashboard export was supplied. No header is guessed and no CSV row is matched.',
          exactExportNeeded: ALL_EXACT_EXPORTS,
        };
      }
      return {
        ok: false,
        code: 'INVALID_DOCUMENT',
        message: 'The file is neither valid JSON nor a recognised CSV export.',
        exactExportNeeded: ALL_EXACT_EXPORTS,
      };
    }

    const records: Record<string, unknown>[] = [];
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const record = asRecord(item);
        if (record) records.push(record);
      }
    } else {
      const record = asRecord(parsed);
      if (!record)
        return {
          ok: false,
          code: 'INVALID_DOCUMENT',
          message: 'A JSON object or array of documented Monnify events is required.',
          exactExportNeeded: ALL_EXACT_EXPORTS,
        };
      records.push(record);
    }

    if (records.length === 0) {
      return {
        ok: false,
        code: 'INVALID_DOCUMENT',
        message: 'The JSON document contains no rows.',
        exactExportNeeded: ALL_EXACT_EXPORTS,
      };
    }

    const first = records[0];
    if (first.eventType && typeof first.eventType === 'string') {
      const kinds = new Set(
        records.map((item) => eventKinds[String(item.eventType)]).filter(Boolean) as ReportKind[],
      );
      if (kinds.size !== 1) {
        return {
          ok: false,
          code: 'INVALID_DOCUMENT',
          message: 'Mixed webhook event types must be uploaded one report kind at a time.',
          exactExportNeeded: ALL_EXACT_EXPORTS,
        };
      }
      const kind = Array.from(kinds)[0];
      return normalise(fileName, records, 'WEBHOOK_EVENT_JSON', fingerprint, kind);
    }

    const body = asRecord(first.responseBody);
    if (!body) {
      return {
        ok: false,
        code: 'INVALID_DOCUMENT',
        message:
          'Only documented responseBody envelopes and webhook event notifications are confirmed formats.',
        exactExportNeeded: ALL_EXACT_EXPORTS,
      };
    }
    const contentRows = Array.isArray(body.content)
      ? body.content
      : body.settlementReference
        ? [body]
        : [];
    const kind = kindFromDocument(body, contentRows);
    if (!kind) {
      return {
        ok: false,
        code: 'INVALID_DOCUMENT',
        message: 'The responseBody does not match a documented collections, payout or settlement shape.',
        exactExportNeeded: ALL_EXACT_EXPORTS,
      };
    }
    return normalise(fileName, [parsed], 'DOCUMENTED_API_JSON', fingerprint, kind);
  },
};

/** Adapter registry. Only Monnify is registered here; NIBSS is intentionally not invented. */
const adapters = new Map<ProviderKey, ProviderAdapter>([[monnifyAdapter.provider, monnifyAdapter]]);

export const registeredAdapters = (): ProviderAdapter[] => Array.from(adapters.values());

export const adapterFor = (provider: ProviderKey): ProviderAdapter | undefined => adapters.get(provider);

/** Test/dependency-injection hook for a future NIBSS adapter. Does not register by default. */
export const registerAdapter = (adapter: ProviderAdapter): void => {
  adapters.set(adapter.provider, adapter);
};

export const exactExportFor = (kind: ReportKind): string => EXACT_EXPORTS[kind];
export const allExactExports = (): string => ALL_EXACT_EXPORTS;
export const providerKeyFromDocument = (document: unknown): ProviderKey | null =>
  asRecord(document) && (document as Record<string, unknown>).eventType
    ? 'MONNIFY'
    : asRecord(document) && asRecord((document as Record<string, unknown>).responseBody)
      ? 'MONNIFY'
      : null;
