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

/** "HH:MM" local clock reading used for "Updated at" freshness indicators. */
export function formatUpdatedAt(timestamp: number): string {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
