import { ContactMethodType } from './customer.enums';

const MASK = '••••';

/**
 * Customer references generated from a verified Nigerian mobile number use `mn-<10 digits>`.
 * Keep references that are not phone-derived intact; mask the phone-derived form everywhere
 * it crosses a workforce servicing boundary.
 */
export function maskCustomerReference(reference: string): string {
  const value = String(reference ?? '');
  const phoneDerived = value.match(/^(mn-)(\d{6,15})$/i);
  if (phoneDerived?.[1] && phoneDerived[2]) {
    return `${phoneDerived[1]}••••${phoneDerived[2].slice(-4)}`;
  }

  const compact = value.replace(/[\s()-]/g, '');
  if (/^\+?(?:234)?[789]\d{9}$/.test(compact)) {
    return `••••${compact.slice(-4)}`;
  }
  return value;
}

export function maskPhoneNumber(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 4) return MASK;
  const suffix = digits.slice(-4);
  if (/^(?:\+?234)?[789]\d{9}$/.test(String(value ?? '').replace(/[\s()-]/g, ''))) {
    return `+234*****${suffix}`;
  }
  return `******${suffix}`;
}

export function maskEmailAddress(value: string): string {
  const [localPart, domain, ...rest] = String(value ?? '').split('@');
  if (!localPart || !domain || rest.length > 0) return MASK;
  const visibleCharacter = Array.from(localPart)[0] ?? '';
  return `${visibleCharacter}•••@${domain}`;
}

export function maskContactValue(type: ContactMethodType | string, value: string): string {
  if (type === ContactMethodType.PHONE || type === 'PHONE') return maskPhoneNumber(value);
  if (type === ContactMethodType.EMAIL || type === 'EMAIL') return maskEmailAddress(value);
  return MASK;
}

export function maskIdentityDocumentNumber(value: string): string {
  const compact = String(value ?? '').replace(/\s/g, '');
  if (compact.length < 4) return MASK;
  return `••••••${compact.slice(-4)}`;
}
