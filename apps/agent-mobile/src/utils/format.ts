/**
 * Presentation-only money formatting (Agent Mobile §2: the client never
 * computes fees/commissions/balances — it only formats server-provided minor
 * units for display, identical to customer-mobile's `balanceMinor / 100`
 * convention).
 */
export function formatNairaFromMinor(balanceMinor: string): string {
  const minor = Number.parseInt(balanceMinor, 10);
  if (!Number.isFinite(minor)) {
    return '₦0.00';
  }
  const naira = minor / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * naira text input → kobo string (presentation-layer unit conversion only,
 * mirroring customer-mobile's `*100` convention; no fees/limits/logic here).
 * Returns null for empty/zero/<=0 or >2 decimal places.
 * Examples: "2500" -> "250000", "2,500.50" -> "250050", "0" -> null.
 */
export function parseNairaInputToMinor(input: string): string | null {
  const cleaned = input.replace(/[,₦\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const naira = Number(cleaned);
  if (!Number.isFinite(naira) || naira <= 0) return null;
  const kobo = Math.round(naira * 100);
  if (!Number.isSafeInteger(kobo) || kobo <= 0) return null;
  return String(kobo);
}

/** Non-secret idempotency key generated once per transaction attempt. */
export function newIdempotencyKey(prefix: string): string {
  const rand = Math.abs(Math.floor(Math.random() * 0xffffffff)).toString(16).padStart(8, '0');
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/** "HH:MM" local clock reading used for "Updated at" freshness indicators. */
export function formatUpdatedAt(timestamp: number): string {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
