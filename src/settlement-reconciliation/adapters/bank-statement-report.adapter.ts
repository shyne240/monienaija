import { BadRequestException } from '@nestjs/common';

import {
  computeRowFingerprint,
  integerMinorString,
  majorDecimalToMinor,
  maskBankAccountNumber,
  sanitizeNarrationMaskingAccounts,
  type NormalizedSettlementReportRow,
  type ParsedSettlementReport,
  type RejectedSettlementReportRow,
  type SettlementFileFormat,
  type SettlementReportFormatDescriptor,
  type SettlementReportType,
} from '../settlement-reconciliation.types';
import { detectFileFormat, parseCsvTable } from './csv-parser';
import type {
  ParseSettlementReportInput,
  SettlementReportProviderAdapter,
} from './settlement-report-adapter.interface';

type AnyRecord = Record<string, unknown>;

const PROVIDER_KEY = 'COMMERCIAL_BANK_STATEMENT';

function pickString(record: AnyRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const val = record[key];
    if (typeof val === 'string' && val.trim().length > 0) return val.trim();
    if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  }
  return null;
}

function parseIsoTimestamp(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}+01:00`
    : /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? `${trimmed}T00:00:00+01:00`
      : trimmed;
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

export class BankStatementReportAdapter implements SettlementReportProviderAdapter {
  readonly providerKey = PROVIDER_KEY;
  readonly displayName = 'Commercial Bank Settlement Account Statement';

  readonly formatDescriptors: readonly SettlementReportFormatDescriptor[] = [
    {
      providerKey: PROVIDER_KEY,
      providerDisplayName: 'Commercial Bank Settlement Account Statement',
      reportType: 'BANK_STATEMENT',
      fileFormat: 'CSV',
      supported: true,
      verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
      documentedSource: 'Corporate Settlement Bank Account Statement CSV (pending bank export)',
      missingSampleNeeded:
        'Redacted corporate settlement bank statement CSV from the designated Nigerian settlement bank',
      note: 'UNVERIFIED exact commercial bank CSV header layout; normalized statement columns (reference, value_date, narration, credit, debit, balance, account_number) are accepted for synthetic/redacted statement reconciliation.',
    },
    {
      providerKey: PROVIDER_KEY,
      providerDisplayName: 'Commercial Bank Settlement Account Statement',
      reportType: 'BANK_STATEMENT',
      fileFormat: 'JSON',
      supported: true,
      verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
      documentedSource: 'Corporate Settlement Bank Account Statement JSON feed (synthetic/redacted)',
      missingSampleNeeded:
        'Redacted corporate settlement bank statement export from the designated Nigerian settlement bank',
      note: 'UNVERIFIED bank statement layout.',
    },
  ];

  supports(reportType: SettlementReportType, fileFormat?: SettlementFileFormat): boolean {
    return this.formatDescriptors.some(
      (item) =>
        item.reportType === reportType &&
        item.supported &&
        (fileFormat === undefined || item.fileFormat === fileFormat),
    );
  }

  parse(input: ParseSettlementReportInput): ParsedSettlementReport {
    if (input.reportType !== 'BANK_STATEMENT') {
      throw new BadRequestException(
        `${PROVIDER_KEY} only supports BANK_STATEMENT imports (received ${input.reportType}).`,
      );
    }
    if (!input.content || !input.content.trim()) {
      throw new BadRequestException('Bank statement content cannot be empty');
    }

    const fileFormat = detectFileFormat(input.fileName, input.content);
    const descriptor = this.formatDescriptors.find((d) => d.fileFormat === fileFormat)!;

    let rawRecords: Array<{ rowNumber: number; record: AnyRecord }>;
    if (fileFormat === 'JSON') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(input.content);
      } catch {
        throw new BadRequestException('Malformed JSON bank statement');
      }
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as AnyRecord).entries)
          ? ((parsed as AnyRecord).entries as unknown[])
          : [parsed];
      rawRecords = arr.map((item, idx) => ({
        rowNumber: idx + 1,
        record: item && typeof item === 'object' && !Array.isArray(item) ? (item as AnyRecord) : {},
      }));
    } else {
      let table;
      try {
        table = parseCsvTable(input.content);
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : 'Malformed CSV bank statement',
        );
      }
      if (table.headers.length === 0) {
        throw new BadRequestException('CSV bank statement has no header row');
      }
      rawRecords = table.rows.map((r) => ({ rowNumber: r.rowNumber, record: { ...r.values } }));
    }

    const validRows: NormalizedSettlementReportRow[] = [];
    const rejectedRows: RejectedSettlementReportRow[] = [];
    let detectedMaskedAccount: string | null = null;
    let currency = (input.defaultCurrency ?? 'NGN').trim().toUpperCase();

    for (const { rowNumber, record } of rawRecords) {
      const entryRef = pickString(record, [
        'statementReference',
        'statement_reference',
        'entryReference',
        'entry_reference',
        'reference',
        'transaction_id',
      ]);
      const rawNarration = pickString(record, ['narration', 'description', 'remarks', 'details']);
      if (!entryRef && !rawNarration) {
        rejectedRows.push({
          rowNumber,
          reasonCode: 'MISSING_STATEMENT_REFERENCE',
          message: 'Bank statement row must include reference or narration.',
          sanitizedPreview: {},
        });
        continue;
      }

      const creditRaw = pickString(record, ['credit', 'credit_amount', 'creditAmount']);
      const debitRaw = pickString(record, ['debit', 'debit_amount', 'debitAmount']);
      const creditMinorRaw = pickString(record, ['credit_minor', 'creditMinor']);
      const debitMinorRaw = pickString(record, ['debit_minor', 'debitMinor']);

      let direction: 'STATEMENT_CREDIT' | 'STATEMENT_DEBIT' | null = null;
      let amountMinor: string | null = null;
      if (creditMinorRaw && integerMinorString(creditMinorRaw) && BigInt(integerMinorString(creditMinorRaw)!) > 0n) {
        direction = 'STATEMENT_CREDIT';
        amountMinor = integerMinorString(creditMinorRaw);
      } else if (debitMinorRaw && integerMinorString(debitMinorRaw) && BigInt(integerMinorString(debitMinorRaw)!) > 0n) {
        direction = 'STATEMENT_DEBIT';
        amountMinor = integerMinorString(debitMinorRaw);
      } else if (creditRaw && majorDecimalToMinor(creditRaw) && BigInt(majorDecimalToMinor(creditRaw)!) > 0n) {
        direction = 'STATEMENT_CREDIT';
        amountMinor = majorDecimalToMinor(creditRaw);
      } else if (debitRaw && majorDecimalToMinor(debitRaw) && BigInt(majorDecimalToMinor(debitRaw)!) > 0n) {
        direction = 'STATEMENT_DEBIT';
        amountMinor = majorDecimalToMinor(debitRaw);
      }

      if (!direction || !amountMinor) {
        rejectedRows.push({
          rowNumber,
          reasonCode: 'INVALID_STATEMENT_AMOUNT',
          message: 'Bank statement row requires a positive credit or debit amount.',
          sanitizedPreview: {
            reference: entryRef,
            narration: sanitizeNarrationMaskingAccounts(rawNarration),
          },
        });
        continue;
      }

      const rawDate = pickString(record, [
        'value_date',
        'valueDate',
        'transaction_date',
        'transactionDate',
        'posted_date',
        'date',
      ]);
      const occurredAt = parseIsoTimestamp(rawDate);
      if (rawDate && !occurredAt) {
        rejectedRows.push({
          rowNumber,
          reasonCode: 'INVALID_TIMESTAMP',
          message: `Unparseable bank statement date "${rawDate}".`,
          sanitizedPreview: { reference: entryRef },
        });
        continue;
      }

      const rowCurrency = (pickString(record, ['currency', 'currency_code']) ?? currency).toUpperCase();
      currency = rowCurrency;
      const balanceMinor =
        integerMinorString(record.balance_minor ?? record.balanceMinor, { allowNegative: true }) ??
        majorDecimalToMinor(record.balance ?? record.closing_balance ?? record.running_balance, {
          allowNegative: true,
        });
      const maskedAccount = maskBankAccountNumber(
        pickString(record, ['account_number', 'accountNumber', 'settlement_account_number']),
      );
      if (!detectedMaskedAccount && maskedAccount) {
        detectedMaskedAccount = maskedAccount;
      }

      const settlementRef =
        pickString(record, ['settlement_reference', 'settlementReference']) ??
        (rawNarration?.match(/\b(SET[-_][A-Za-z0-9_-]{4,64})\b/i)?.[1] ?? null);
      const payoutRef = pickString(record, ['payout_reference', 'payoutReference']);

      validRows.push({
        rowNumber,
        direction,
        providerTransactionReference: entryRef,
        platformReference: entryRef,
        paymentReference: null,
        settlementReference: settlementRef,
        payoutReference: payoutRef,
        nipSessionId: pickString(record, ['session_id', 'sessionId', 'nip_session_id']),
        refundOrDisputeReference: null,
        currency: rowCurrency,
        grossAmountMinor: amountMinor,
        providerFeeMinor: '0',
        netAmountMinor: amountMinor,
        runningBalanceAfterMinor: balanceMinor,
        providerStatus: 'POSTED',
        occurredAt,
        settledAt: occurredAt,
        maskedCounterpartyAccount: null,
        maskedDestinationAccount: maskedAccount,
        counterpartyBankCode: pickString(record, ['bank_code', 'bankCode']),
        narration: sanitizeNarrationMaskingAccounts(rawNarration),
        underlyingItems: [],
        normalizedAttributes: { statementSource: 'BANK_STATEMENT' },
        rowFingerprint: computeRowFingerprint({
          providerKey: PROVIDER_KEY,
          reportType: 'BANK_STATEMENT',
          direction,
          providerTransactionReference: entryRef,
          platformReference: entryRef,
          paymentReference: null,
          settlementReference: settlementRef,
          payoutReference: payoutRef,
          nipSessionId: null,
          refundOrDisputeReference: null,
          currency: rowCurrency,
          grossAmountMinor: amountMinor,
          providerFeeMinor: '0',
          netAmountMinor: amountMinor,
          providerStatus: 'POSTED',
          occurredAt,
        }),
      });
    }

    return {
      providerKey: PROVIDER_KEY,
      reportType: 'BANK_STATEMENT',
      fileFormat,
      verificationStatus: descriptor.verificationStatus,
      verificationNote: descriptor.note,
      missingSampleNeeded: descriptor.missingSampleNeeded,
      currency,
      detectedMaskedAccount,
      totalRows: rawRecords.length,
      validRows,
      rejectedRows,
    };
  }
}
