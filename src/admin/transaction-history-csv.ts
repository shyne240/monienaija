/**
 * Transaction History CSV serialisation.
 *
 * Everything here is pure: no database, no HTTP, no authorization. It exists as its own module so
 * the two properties that matter most — a value can never escape its cell, and an untrusted value
 * can never be executed as a spreadsheet formula — are provable in isolation and cannot drift
 * between the export path and its tests.
 *
 * ## Currency arithmetic is done on strings, not floats
 *
 * History amounts are `bigint` minor units handed around as strings. `Number('…')`/`/ 100` loses
 * precision past 2^53 and silently rounds a kobo, so every conversion here is integer string
 * arithmetic. A `bigint` would also work; strings are used because the value never touches a
 * numeric literal at all.
 */

/**
 * Stable column vocabulary. The order is part of the contract: a downstream reconciliation that
 * indexes columns by position must not be broken by a reorder, so this list only ever grows.
 */
export const CSV_COLUMNS = [
  'transaction_reference',
  'product',
  'product_label',
  'status',
  'created_at_lagos',
  'created_at_utc',
  'amount',
  'currency',
  'fee',
  'fee_recorded',
  'business_transaction_id',
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** One row, already authorised and scoped by the caller. */
export interface HistoryExportRow {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly reference: string;
  readonly createdAt: string;
  readonly amountMinor: string;
  readonly feeMinor: string | null;
  readonly currency: string;
}

export interface CsvValueRow {
  readonly transaction_reference: string;
  readonly product: string;
  readonly product_label: string;
  readonly status: string;
  readonly created_at_lagos: string;
  readonly created_at_utc: string;
  readonly amount: string;
  readonly currency: string;
  /** Empty when no fee was recorded; `0.00` when a zero fee was recorded. */
  readonly fee: string;
  /** `true`/`false`: distinguishes "no fee recorded" from "recorded as zero". */
  readonly fee_recorded: string;
  readonly business_transaction_id: string;
}

/**
 * Human labels mirror the list screen so an operator reads the same product name in both places.
 * An unmapped type keeps its stable machine name rather than becoming blank.
 */
export const PRODUCT_LABELS: Readonly<Record<string, string>> = {
  WALLET_TRANSFER: 'Wallet transfer',
  CASH_IN: 'Cash to Wallet',
  CASH_OUT: 'Wallet to Cash',
  CASH_TO_CASH: 'Cash to Cash',
  WALLET_TO_BANK: 'Wallet to Bank',
  BANK_TO_WALLET: 'Bank to Wallet',
  CUSTOMER_FUNDING: 'Customer Funding',
  AGENT_FUNDING: 'Agent Funding',
  AGENT_DEFUNDING: 'Agent Defunding',
};

/**
 * Spreadsheet formula neutralisation.
 *
 * Excel, LibreOffice and Google Sheets treat a cell whose text begins with `=`, `+`, `-`, `@`, a
 * tab or a carriage return as a formula (the tab/CR variants are the classic bypass past a naive
 * `=+-@` check). A transaction reference is operator-searchable free text, so it is untrusted.
 *
 * The mitigation is a leading apostrophe, which every one of those products renders as "this is
 * text" and does not display. Values that are already safe are returned unchanged — this must not
 * be applied twice, or the second pass would prefix a legitimate apostrophe.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * RFC 4180 cell escaping: wrap in double quotes when the value contains a delimiter, quote,
 * newline or leading/trailing space, and double any embedded quote. Quoting alone is NOT enough
 * for formula safety, so callers must pass untrusted text through `neutralizeFormula` first —
 * `csvCell` deliberately does not do it, so a value can never be neutralised twice.
 */
export function csvCell(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Escapes untrusted free text: formula neutralisation, then RFC 4180 quoting. */
export function csvText(value: string): string {
  return csvCell(neutralizeFormula(value));
}

/**
 * Minor units → exact decimal string. Integer-only arithmetic; never uses `Number`.
 * `-1250n` becomes `-12.50`, `5n` becomes `0.05`, `NULL` never reaches here.
 */
export function minorUnitsToDecimal(minor: string): string {
  if (!/^-?\d+$/.test(minor)) throw new Error('Minor units must be an integer string');
  const negative = minor.startsWith('-');
  const digits = (negative ? minor.slice(1) : minor).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Lagos wall-clock rendering. Africa/Lagos is a fixed UTC+01:00 offset with no DST, and the
 * history list renders Lagos time, so the export uses the same zone instead of the server's
 * local time (an export must not depend on where the process happens to run).
 */
export function lagosTimestamp(iso: string): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) throw new Error('Invalid transaction timestamp');
  const lagos = new Date(at.getTime() + 60 * 60 * 1000);
  return lagos.toISOString().slice(0, 19).replace('T', ' ');
}

/** UTC rendering in the same shape, for consumers that need a machine-readable instant. */
export function utcTimestamp(iso: string): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) throw new Error('Invalid transaction timestamp');
  return at.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Maps one authorised history row to the exact exported cells.
 *
 * Masking/authorisation has already happened upstream (the row comes from the same scoped query
 * that serves the list); this function only decides representation. Fields the operator cannot
 * read in the list are not in `HistoryExportRow` at all, so the export cannot widen the surface.
 */
export function toCsvValues(row: HistoryExportRow): CsvValueRow {
  return {
    transaction_reference: row.reference,
    product: row.type,
    product_label: PRODUCT_LABELS[row.type] ?? row.type,
    status: row.status,
    created_at_lagos: lagosTimestamp(row.createdAt),
    created_at_utc: utcTimestamp(row.createdAt),
    amount: minorUnitsToDecimal(row.amountMinor),
    currency: row.currency,
    // `null` is "not recorded"; `'0'` is a recorded zero. They must never collapse.
    fee: row.feeMinor === null ? '' : minorUnitsToDecimal(row.feeMinor),
    fee_recorded: row.feeMinor === null ? 'false' : 'true',
    business_transaction_id: row.id,
  };
}

/**
 * Serialises a complete document.
 *
 * - CRLF line endings and a UTF-8 BOM: what Excel on Windows needs to open a Nigerian-currency
 *   file with the right encoding on a double click instead of mangling it.
 * - No trailing blank line: a trailing CRLF is read as one extra empty row by some importers, and
 *   "exactly once" row accounting is the acceptance criterion here.
 */
export function renderCsv(rows: readonly HistoryExportRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    const values = toCsvValues(row);
    lines.push(
      CSV_COLUMNS.map((column) => {
        const value = values[column];
        // Only free-text identity columns are untrusted; the rest are constrained vocabulary,
        // numeric strings or ISO timestamps. Escape everything, neutralise only untrusted text.
        return column === 'transaction_reference' ? csvText(value) : csvCell(value);
      }).join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

/** Filename derived from the applied filters, with no user-controlled characters. */
export function exportFileName(applied: {
  readonly from?: string;
  readonly to?: string;
  readonly type?: string;
}): string {
  const range =
    applied.from || applied.to
      ? `${applied.from || 'start'}_to_${applied.to || 'now'}`
      : 'all-dates';
  const product = applied.type ? `_${applied.type.toLowerCase()}` : '';
  return `transaction-history_${range}${product}.csv`;
}
