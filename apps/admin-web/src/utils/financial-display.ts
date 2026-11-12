/** Display the exact server-provided integer in its declared minor unit.
 * No floating-point conversion or currency exponent is assumed. */
export function formatMinorUnits(value: string, currency: string): string {
  if (!/^-?\d+$/.test(value)) return `${currency} ${value} minor units`;
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).replace(/^0+(?=\d)/, '');
  return `${currency} ${negative ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} minor units`;
}

/** NGN has 100 kobo per naira. Other currencies stay in their authoritative minor unit. */
export function formatFinancialAmount(value: string, currency: string): string {
  if (currency !== 'NGN' || !/^-?\d+$/.test(value)) return formatMinorUnits(value, currency);
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount < 0n ? '-' : ''}₦${whole}.${String(absolute % 100n).padStart(2, '0')}`;
}
