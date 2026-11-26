export function maskCustomerReference(reference: string | null | undefined): string {
  const value = String(reference ?? '');
  const match = value.match(/^(mn-)(\d{6,15})$/i);
  return match ? `${match[1]}••••${match[2].slice(-4)}` : value;
}

export function maskContactValue(value: string): string {
  if (value.includes('@')) {
    const [name, domain] = value.split('@');
    return `${name?.[0] ?? ''}•••@${domain ?? ''}`;
  }
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : '••••';
}

/**
 * Masks a wallet's internal identifier for display.
 *
 * A wallet id addresses an account in our ledger; it means nothing to a member of staff reading a
 * customer record and should not be copied out of one. Only the last four characters survive, the
 * same rule the printable statement uses for the identifier it prints.
 */
export function maskWalletIdentifier(walletId: string | null | undefined): string {
  const value = String(walletId ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return '••••';
  return `•••• ${value.replace(/-/g, '').slice(-4).toUpperCase()}`;
}
