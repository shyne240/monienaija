import type { InternalRecord, StatementEntry } from './types';

/** Local validation for redacted/synthetic internal and statement snapshots. No API is called. */

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
const minor = (value: unknown): string | undefined =>
  typeof value === 'string' && /^-?\d+$/.test(value) ? value : undefined;

const listFrom = (parsed: unknown): unknown[] => {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.records)) return record.records;
    if (Array.isArray(record.items)) return record.items;
  }
  return [];
};

export const parseInternalSnapshot = (
  content: string,
): { ok: true; records: InternalRecord[] } | { ok: false; error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: 'Internal snapshot must be valid JSON.' };
  }
  const rows = listFrom(parsed);
  if (rows.length === 0) return { ok: false, error: 'Internal snapshot contains no records.' };
  const records: InternalRecord[] = [];
  for (const [index, item] of rows.entries()) {
    if (!item || typeof item !== 'object') return { ok: false, error: `Record ${index + 1} is not an object.` };
    const row = item as Record<string, unknown>;
    const id = str(row.id);
    const amountMinor = minor(row.amountMinor);
    const currency = str(row.currency);
    const status = str(row.status);
    const type = str(row.type);
    if (!id || !amountMinor || !currency || !status || !type)
      return {
        ok: false,
        error: `Record ${index + 1} needs id, amountMinor, currency, status and type.`,
      };
    records.push({
      id,
      reference: str(row.reference),
      businessReference: str(row.businessReference),
      providerTransactionReference: str(row.providerTransactionReference),
      settlementReference: str(row.settlementReference),
      nipSessionId: str(row.nipSessionId),
      amountMinor,
      currency,
      status,
      type,
      journalId: str(row.journalId),
      institutionId: str(row.institutionId),
    });
  }
  return { ok: true, records };
};

export const parseStatementSnapshot = (
  content: string,
): { ok: true; entries: StatementEntry[] } | { ok: false; error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: 'Statement snapshot must be valid JSON.' };
  }
  const rows = listFrom(parsed);
  if (rows.length === 0) return { ok: false, error: 'Statement snapshot contains no lines.' };
  const entries: StatementEntry[] = [];
  for (const [index, item] of rows.entries()) {
    if (!item || typeof item !== 'object') return { ok: false, error: `Statement line ${index + 1} is not an object.` };
    const row = item as Record<string, unknown>;
    const id = str(row.id);
    const date = str(row.date);
    const amountMinor = minor(row.amountMinor);
    const currency = str(row.currency);
    if (!id || !date || !amountMinor || !currency)
      return {
        ok: false,
        error: `Statement line ${index + 1} needs id, date, amountMinor and currency.`,
      };
    entries.push({
      id,
      date,
      amountMinor,
      currency,
      settlementReference: str(row.settlementReference),
      destinationAccountNumber: str(row.destinationAccountNumber),
      destinationBankCode: str(row.destinationBankCode),
      narration: str(row.narration),
    });
  }
  return { ok: true, entries };
};
