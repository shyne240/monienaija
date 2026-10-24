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
