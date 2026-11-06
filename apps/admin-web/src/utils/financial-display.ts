/** Display the exact server-provided integer in its declared minor unit.
 * No floating-point conversion or currency exponent is assumed. */
export function formatMinorUnits(value: string, currency: string): string {
  if (!/^-?\d+$/.test(value)) return `${currency} ${value} minor units`;
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).replace(/^0+(?=\d)/, '');
  return `${currency} ${negative ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} minor units`;
}
