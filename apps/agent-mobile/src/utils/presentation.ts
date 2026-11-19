/**
 * Presentation helpers — agent-mobile reuses the customer-mobile convention.
 * Deliberately presentation-only: formats server-provided minor units for display.
 * Reuses existing pattern rather than duplicating logic.
 */
const NAIRA = '₦';

export function formatMinor(minor: string | number | null | undefined): string {
  if (minor === null || minor === undefined || minor === '') return '—';
  const value = Number(minor);
  if (!Number.isFinite(value)) return '—';
  return `${NAIRA}${(value / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export { formatNairaFromMinor } from './format';
