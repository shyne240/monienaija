/**
 * Wallet statement — pure formatting, masking and validation.
 *
 * Nothing here touches a database, a request or the filesystem, so the properties that matter most
 * for a document that leaves the building are provable in isolation:
 *
 *  - a day boundary is a *Lagos* day, and it is inclusive at both ends;
 *  - an internal identifier or a staff-entered note can never reach the page;
 *  - minor units are converted by string arithmetic, never by `Number`;
 *  - an unavailable figure stays `null` all the way to the renderer.
 */

import { BadRequestException } from '@nestjs/common';

import type { StatementPeriod } from './wallet-statement.types';

/** Africa/Lagos is a fixed UTC+01:00 offset with no DST, so boundaries are exact, not tz-database-dependent. */
export const LAGOS_OFFSET_MS = 60 * 60 * 1000;
export const LAGOS_TIME_ZONE = 'Africa/Lagos';

/** Longest statement the product supports, in Lagos days. */
export const MAX_STATEMENT_DAYS = 366;

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** 11+ contiguous digits with no separators is a phone number or account number, not an amount. */
const LONG_DIGIT_RUN = /\d{11,}/g;
const PLACEHOLDER = '[withheld]';

function parseDay(value: string, field: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must be a date in YYYY-MM-DD form`);
  }
  const at = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} is not a real calendar date`);
  }
  return at;
}

/**
 * Validates an inclusive Lagos-day period and converts it to exact UTC instants.
 *
 * `from` 00:00 Lagos is 23:00Z of the previous UTC day; the period ends at 00:00 Lagos of the day
 * *after* `to`, which makes `to` inclusive without a `<= 23:59:59.999999` guess that would drop a
 * posting at exactly midnight.
 */
export function parseStatementPeriod(from: string, to: string): StatementPeriod {
  const fromDay = parseDay(from, 'from');
  const toDay = parseDay(to, 'to');
  if (fromDay > toDay) throw new BadRequestException('The statement period is reversed');
  const days = Math.round((toDay - fromDay) / 86_400_000) + 1;
  if (days > MAX_STATEMENT_DAYS) {
    throw new BadRequestException(
      `A statement covers at most ${MAX_STATEMENT_DAYS} days; choose a shorter period`,
    );
  }
  const fromInstant = new Date(fromDay - LAGOS_OFFSET_MS).toISOString();
  const toInstantExclusive = new Date(toDay + 86_400_000 - LAGOS_OFFSET_MS).toISOString();
  return { from, to, fromInstant, toInstantExclusive };
}

/** Inclusive Lagos day for an instant, as `YYYY-MM-DD`. */
export function lagosDay(instant: string | Date): string {
  const at = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(at.getTime())) throw new BadRequestException('Invalid instant');
  return new Date(at.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** Lagos wall clock for an instant, `YYYY-MM-DD HH:mm`. */
export function lagosDateTime(instant: string | Date): string {
  const at = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(at.getTime())) throw new BadRequestException('Invalid instant');
  return new Date(at.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Minor units → exact decimal string, by string arithmetic only.
 * `-1250` becomes `-12.50`; `5` becomes `0.05`.
 */
export function minorUnitsToDecimal(minor: string): string {
  if (!/^-?\d+$/.test(minor)) throw new Error('Minor units must be an integer string');
  const negative = minor.startsWith('-');
  const digits = (negative ? minor.slice(1) : minor).padStart(3, '0');
  return `${negative && digits !== '000' ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** `1250000` becomes `12,500.00`. Grouping is integer-string based, never float-based. */
export function groupedDecimal(minor: string): string {
  const decimal = minorUnitsToDecimal(minor);
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = '00'] = (negative ? decimal.slice(1) : decimal).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}

/** `1250000` + `NGN` becomes `NGN 12,500.00`. */
export function formatMoney(minor: string, currency: string): string {
  const negative = minor.startsWith('-');
  return `${negative ? '-' : ''}${currency} ${groupedDecimal(negative ? minor.slice(1) : minor)}`;
}

/**
 * Signed display of a period amount: credits are shown plainly, debits in parentheses with a
 * minus, because a statement column must never be ambiguous about direction.
 */
export function formatSignedMoney(minor: string, currency: string): string {
  return minor.startsWith('-')
    ? `(${formatMoney(minor.slice(1), currency)})`
    : formatMoney(minor, currency);
}

/**
 * Masks a wallet identifier for the document.
 *
 * The full wallet id is an internal account identifier that a customer-facing document has no
 * reason to print, so only the last four characters survive. A caller that needs the whole id reads
 * it from the audit trail, which is where it belongs.
 */
export function maskWalletIdentifier(walletId: string): string {
  const compact = String(walletId ?? '').replace(/-/g, '');
  if (!UUID_EXACT.test(String(walletId ?? ''))) return '••••';
  const tail = compact.slice(-4).toUpperCase();
  return `•••• ${tail}`;
}

/**
 * Removes internal identifiers from a journal narration.
 *
 * Journal descriptions are business narration, but they are written by code paths that
 * legitimately embed internal identifiers — `Cash→Wallet 500 NGN from Agent <agent-id> to Customer
 * <customer-id>`, `Transfer <transfer-id>`, `Reversal of journal <journal-id>`. A statement must not
 * carry another party's internal id or the ledger's own ids out of the building, so identifiers,
 * email addresses and long digit runs (phone/account numbers) are replaced before anything is laid
 * out. The result is bounded, whitespace-collapsed and empty strings become `null`.
 */
export function sanitizeNarration(narration: string | null | undefined): string | null {
  if (typeof narration !== 'string') return null;
  const cleaned = narration
    // Collapse dotted key paths first so `j.<uuid>` becomes one placeholder, not "j." + placeholder.
    .replace(
      /(?:\b[a-z_][a-z0-9_]*\.)+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
      PLACEHOLDER,
    )
    .replace(UUID_PATTERN, PLACEHOLDER)
    .replace(EMAIL_PATTERN, PLACEHOLDER)
    .replace(LONG_DIGIT_RUN, PLACEHOLDER)
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, 240);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Narration for a journal, with staff-entered free text deliberately excluded.
 *
 * A reversal carries an operator-supplied `reason` as its journal description. That is an internal
 * note about why a correction was made, not something to publish on a customer statement, so a
 * reversal always renders as a fixed label. Every other journal renders its sanitised business
 * narration.
 */
export function statementNarration(journal: {
  description: string | null;
  reversalOfJournalId: string | null;
}): string | null {
  if (journal.reversalOfJournalId) return 'Reversal of an earlier posting';
  return sanitizeNarration(journal.description);
}

/**
 * Short, human-readable reference for the document footer.
 *
 * The full statement id is a UUID that lives in the audit trail and the response headers, where it
 * belongs. A customer-facing document prints a short reference that an operator can quote on a call
 * and that still resolves to exactly one audit row, instead of a raw internal identifier.
 */
export function statementReference(statementId: string): string {
  const compact = String(statementId ?? '').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(compact)) return 'STMT-UNKNOWN';
  return `STMT-${compact.slice(0, 8).toUpperCase()}`;
}

/** File name for the generated document. Deterministic: an operator can find it again. */
export function statementFileName(input: { walletId: string; from: string; to: string }): string {
  const tail = input.walletId.replace(/-/g, '').slice(-4).toUpperCase();
  return `monienaija-wallet-statement-${tail}-${input.from}_${input.to}.pdf`;
}
